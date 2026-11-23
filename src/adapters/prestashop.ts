import { fetchJson, StoreError } from "../http.js";
import { multiplyAmount, parseAmount } from "../money.js";
import {
  orderSchema,
  productSchema,
  type Product,
  type ProductSummary,
  type StockItem,
} from "../schemas.js";
import type { StoreAdapter } from "./StoreAdapter.js";

// ponytail: search and low-stock scan the first 50 rows. Upgrade path: a per-language name filter, and stock_availables filter[quantity], once the shop's PrestaShop build is known.
const PAGE = 50;

export function createPrestaShopAdapter(options: {
  url: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): StoreAdapter {
  const root = options.url.endsWith("/") ? options.url : `${options.url}/`;
  const secrets = [options.apiKey];
  const authorization = `Basic ${Buffer.from(`${options.apiKey}:`).toString("base64")}`;
  let currencies: Map<string, string> | undefined;

  async function request(
    path: string,
    query?: Record<string, string>,
    method?: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = new URL(path.replace(/^\//, ""), root);
    url.searchParams.set("output_format", "JSON");
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    return fetchJson(url, {
      method,
      body,
      headers: { authorization },
      secrets,
      fetchImpl: options.fetchImpl,
    });
  }

  async function currencyMap(): Promise<Map<string, string>> {
    if (currencies) return currencies;
    const rows = collection(
      await request("api/currencies", { display: "[id,iso_code,active]" }),
      "currencies",
    );
    const map = new Map<string, string>();
    for (const row of rows) {
      if (String(row.active ?? "1") === "0") continue;
      const iso = row.iso_code;
      if (typeof iso !== "string" || !/^[A-Z]{3}$/.test(iso)) continue;
      map.set(idOf(row.id), iso);
    }
    if (map.size === 0) throw new StoreError("No active currency", undefined, "bad_response");
    currencies = map;
    return map;
  }

  async function defaultCurrency(): Promise<string> {
    // ponytail: product prices use the first active currency. Upgrade path: PS_CURRENCY_DEFAULT.
    const map = await currencyMap();
    const first = map.values().next().value;
    if (!first) throw new StoreError("No active currency", undefined, "bad_response");
    return first;
  }

  async function loadProduct(id: string): Promise<Record<string, unknown>> {
    try {
      return unwrap(await request(`api/products/${encodeURIComponent(id)}`), "product");
    } catch (error) {
      if (error instanceof StoreError && error.status === 404) {
        throw new StoreError(`Product ${id} not found`, 404, "not_found");
      }
      throw error;
    }
  }

  async function stockQuantity(product: Record<string, unknown>): Promise<number | null> {
    const stockId = stockAvailableId(product);
    if (!stockId) return null;
    const row = unwrap(await request(`api/stock_availables/${stockId}`), "stock_available");
    return intOf(row.quantity);
  }

  async function toProduct(row: Record<string, unknown>, currency: string): Promise<Product> {
    return productSchema.parse({
      ...toSummary(row, currency),
      stockQuantity: await stockQuantity(row),
      description: localized(row.description) ?? localized(row.description_short),
      seoTitle: localized(row.meta_title),
      seoDescription: localized(row.meta_description),
      permalink: null,
      updatedAt: typeof row.date_upd === "string" ? row.date_upd : null,
    });
  }

  return {
    type: "prestashop",
    readOnly: false,
    async searchProducts({ query, limit }) {
      const currency = await defaultCurrency();
      const rows = collection(
        await request("api/products", {
          display: "[id,name,reference,price,active]",
          limit: `0,${PAGE}`,
        }),
        "products",
      );
      const needle = query?.trim().toLowerCase();
      const matched = rows.filter((row) => {
        if (!needle) return true;
        const name = (localized(row.name) ?? "").toLowerCase();
        const sku = String(row.reference ?? "").toLowerCase();
        return name.includes(needle) || sku.includes(needle);
      });
      return matched.slice(0, limit).map((row) => toSummary(row, currency));
    },
    async getProduct(id) {
      return toProduct(await loadProduct(id), await defaultCurrency());
    },
    async getOrder(id) {
      let row: Record<string, unknown>;
      try {
        row = unwrap(await request(`api/orders/${encodeURIComponent(id)}`), "order");
      } catch (error) {
        if (error instanceof StoreError && error.status === 404) {
          throw new StoreError(`Order ${id} not found`, 404, "not_found");
        }
        throw error;
      }
      const map = await currencyMap();
      const currency = map.get(idOf(row.id_currency)) ?? (await defaultCurrency());
      const associations = asRecord(row.associations, "associations", true);
      const lines = Array.isArray(associations?.order_rows) ? associations.order_rows : [];
      const order = {
        id: idOf(row.id),
        status: String(row.current_state ?? ""),
        total: { amount: parseAmount(row.total_paid), currency },
        customerEmail: null,
        createdAt: typeof row.date_add === "string" ? row.date_add : "",
        lineItems: lines.map((line) => {
          const item = asRecord(line, "order_row");
          const quantity = intOf(item.product_quantity) ?? 0;
          const unit = parseAmount(item.product_price);
          return {
            productId: idOf(item.product_id),
            name: typeof item.product_name === "string" ? item.product_name : "",
            quantity,
            total: { amount: multiplyAmount(unit, quantity), currency },
          };
        }),
      };
      const parsed = orderSchema.safeParse(order);
      if (!parsed.success)
        throw new StoreError("Unexpected order payload", undefined, "bad_response");
      return parsed.data;
    },
    async listLowStock({ threshold, limit }) {
      const currency = await defaultCurrency();
      const rows = collection(
        await request("api/stock_availables", {
          display: "[id,id_product,id_product_attribute,quantity]",
          "filter[id_product_attribute]": "[0]",
          "filter[quantity]": `[0,${threshold}]`,
          limit: `0,${PAGE}`,
        }),
        "stock_availables",
      );
      const items: StockItem[] = [];
      for (const row of rows) {
        if (items.length >= limit) break;
        if (String(row.id_product_attribute ?? "0") !== "0") continue;
        const quantity = intOf(row.quantity);
        if (quantity === null || quantity > threshold) continue;
        const product = await loadProduct(idOf(row.id_product));
        const summary = toSummary(product, currency);
        items.push({
          productId: summary.id,
          name: summary.name,
          sku: summary.sku,
          stockQuantity: quantity,
          lowStockThreshold: threshold,
        });
      }
      return items;
    },
    async updateProductPrice(id, price) {
      await request(`api/products/${encodeURIComponent(id)}`, undefined, "PUT", {
        product: { id, price },
      });
      return toProduct(await loadProduct(id), await defaultCurrency());
    },
    async updateProductSeo(id, seo) {
      const current = await loadProduct(id);
      const product: Record<string, unknown> = { id };
      // ponytail: writes the first language only. Upgrade path: PRESTASHOP_LANGUAGE_ID for multi-language shops.
      if (seo.seoTitle !== undefined)
        product.meta_title = localizedWrite(current.meta_title, seo.seoTitle);
      if (seo.seoDescription !== undefined) {
        product.meta_description = localizedWrite(current.meta_description, seo.seoDescription);
      }
      await request(`api/products/${encodeURIComponent(id)}`, undefined, "PUT", { product });
      return toProduct(await loadProduct(id), await defaultCurrency());
    },
    async updateStock(id, stockQuantity) {
      const current = await loadProduct(id);
      const stockId = stockAvailableId(current);
      if (!stockId)
        throw new StoreError(`Product ${id} has no stock record`, undefined, "bad_response");
      await request(`api/stock_availables/${stockId}`, undefined, "PUT", {
        stock_available: {
          id: stockId,
          id_product: id,
          id_product_attribute: "0",
          quantity: stockQuantity,
        },
      });
      return toProduct(await loadProduct(id), await defaultCurrency());
    },
  };
}

function toSummary(row: Record<string, unknown>, currency: string): ProductSummary {
  const reference = row.reference;
  const sku =
    typeof reference === "string" && reference.trim() ? reference.trim() : localized(reference);
  return {
    id: idOf(row.id),
    name: localized(row.name) ?? "",
    sku,
    price: { amount: parseAmount(row.price), currency },
    stockQuantity: null,
    status: String(row.active ?? "1") === "0" ? "inactive" : "active",
  };
}

function stockAvailableId(product: Record<string, unknown>): string | undefined {
  const associations = asRecord(product.associations, "associations", true);
  const rows =
    associations && Array.isArray(associations.stock_availables)
      ? associations.stock_availables
      : [];
  for (const row of rows) {
    const record = asRecord(row, "stock_available", true);
    if (!record) continue;
    if (String(record.id_product_attribute ?? "0") !== "0") continue;
    return idOf(record.id);
  }
  return undefined;
}

function localized(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value : null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = localized(entry);
      if (text) return text;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  if ("value" in value) return localized((value as { value: unknown }).value);
  if ("language" in value) return localized((value as { language: unknown }).language);
  return null;
}

function localizedWrite(existing: unknown, value: string): Array<{ id: string; value: string }> {
  return [{ id: firstLanguageId(existing) ?? "1", value }];
}

function firstLanguageId(value: unknown): string | undefined {
  if (Array.isArray(value)) return firstLanguageId(value[0]);
  if (!value || typeof value !== "object") return undefined;
  if ("language" in value) return firstLanguageId((value as { language: unknown }).language);
  if ("id" in value && "value" in value) return String((value as { id: unknown }).id);
  return undefined;
}

function collection(payload: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(payload))
    return payload.map((item, index) => asRecord(item, `${key}[${index}]`));
  const record = asRecord(payload, key);
  const value = record[key];
  if (value == null) return [];
  if (!Array.isArray(value))
    throw new StoreError(`Expected a list of ${key}`, undefined, "bad_response");
  return value.map((item, index) => asRecord(item, `${key}[${index}]`));
}

function unwrap(payload: unknown, key: string): Record<string, unknown> {
  const record = asRecord(payload, key);
  const inner = record[key];
  if (inner && typeof inner === "object" && !Array.isArray(inner)) return asRecord(inner, key);
  return record;
}

function asRecord(value: unknown, label: string, optional?: false): Record<string, unknown>;
function asRecord(
  value: unknown,
  label: string,
  optional: true,
): Record<string, unknown> | undefined;
function asRecord(
  value: unknown,
  label: string,
  optional = false,
): Record<string, unknown> | undefined {
  if (value == null && optional) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StoreError(`Unexpected ${label} payload`, undefined, "bad_response");
  }
  return value as Record<string, unknown>;
}

function idOf(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new StoreError("Missing id", undefined, "bad_response");
}

function intOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
}
