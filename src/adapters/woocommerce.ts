import { z } from "zod";
import { fetchJson, StoreError } from "../http.js";
import { parseAmount } from "../money.js";
import { productSchema, type Product, type ProductSummary, type StockItem } from "../schemas.js";
import type { StoreAdapter } from "./StoreAdapter.js";

const SEO_TITLE_KEYS = ["seo_title", "_yoast_wpseo_title", "rank_math_title"] as const;
const SEO_DESCRIPTION_KEYS = [
  "seo_description",
  "_yoast_wpseo_metadesc",
  "rank_math_description",
] as const;
const WRITE_TITLE_KEY = "seo_title";
const WRITE_DESCRIPTION_KEY = "seo_description";

const metaSchema = z.object({
  id: z.number().optional(),
  key: z.string(),
  value: z.unknown(),
});

const wooProductSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    sku: z.string().optional().default(""),
    permalink: z.string().optional(),
    status: z.string(),
    price: z.string().optional().default(""),
    regular_price: z.string().optional().default(""),
    description: z.string().optional().default(""),
    manage_stock: z.boolean().nullable().optional(),
    stock_quantity: z.number().nullable().optional(),
    date_modified_gmt: z.string().nullable().optional(),
    meta_data: z.array(metaSchema).optional().default([]),
  })
  .passthrough();

const wooOrderSchema = z.object({
  id: z.number(),
  status: z.string(),
  currency: z.string(),
  total: z.string(),
  billing: z.object({ email: z.string().optional() }).optional(),
  date_created_gmt: z.string(),
  line_items: z.array(
    z.object({
      product_id: z.number(),
      name: z.string(),
      quantity: z.number().int(),
      total: z.string(),
    }),
  ),
});

type WooProduct = z.infer<typeof wooProductSchema>;
type Meta = z.infer<typeof metaSchema>;

export function createWooCommerceAdapter(options: {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  fetchImpl?: typeof fetch;
}): StoreAdapter {
  const root = options.url.endsWith("/") ? options.url : `${options.url}/`;
  const secrets = [options.consumerKey, options.consumerSecret];
  const authorization = `Basic ${Buffer.from(`${options.consumerKey}:${options.consumerSecret}`).toString("base64")}`;
  let currency: string | undefined;

  function endpoint(path: string, query?: Record<string, string>): URL {
    const url = new URL(`wp-json/wc/v3/${path.replace(/^\//, "")}`, root);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    return url;
  }

  async function request(
    path: string,
    query?: Record<string, string>,
    method?: string,
    body?: unknown,
  ): Promise<unknown> {
    return fetchJson(endpoint(path, query), {
      method,
      body,
      headers: { authorization },
      secrets,
      fetchImpl: options.fetchImpl,
    });
  }

  async function shopCurrency(): Promise<string> {
    if (currency) return currency;
    const payload = await request("settings/general/woocommerce_currency");
    const parsed = z.object({ value: z.string().regex(/^[A-Z]{3}$/) }).safeParse(payload);
    if (!parsed.success)
      throw new StoreError("Unexpected currency payload", undefined, "bad_response");
    currency = parsed.data.value;
    return currency;
  }

  function mapProduct(raw: WooProduct, code: string): Product {
    const amount = raw.price !== "" ? raw.price : raw.regular_price;
    return productSchema.parse({
      id: String(raw.id),
      name: raw.name,
      sku: raw.sku.trim() ? raw.sku : null,
      price: { amount: parseAmount(amount), currency: code },
      stockQuantity: raw.manage_stock ? (raw.stock_quantity ?? null) : null,
      status: raw.status,
      description: raw.description.trim() ? raw.description : null,
      seoTitle: metaText(raw.meta_data, SEO_TITLE_KEYS),
      seoDescription: metaText(raw.meta_data, SEO_DESCRIPTION_KEYS),
      permalink: raw.permalink?.trim() ? raw.permalink : null,
      updatedAt: raw.date_modified_gmt ?? null,
    });
  }

  async function readProduct(id: string): Promise<{ raw: WooProduct; product: Product }> {
    let payload: unknown;
    try {
      payload = await request(`products/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof StoreError && error.status === 404) {
        throw new StoreError(`Product ${id} not found`, 404, "not_found");
      }
      throw error;
    }
    const parsed = wooProductSchema.safeParse(payload);
    if (!parsed.success)
      throw new StoreError("Unexpected product payload", undefined, "bad_response");
    return { raw: parsed.data, product: mapProduct(parsed.data, await shopCurrency()) };
  }

  async function listProducts(query: Record<string, string>): Promise<WooProduct[]> {
    const payload = await request("products", query);
    const parsed = z.array(wooProductSchema).safeParse(payload);
    if (!parsed.success) throw new StoreError("Unexpected product list", undefined, "bad_response");
    return parsed.data;
  }

  return {
    type: "woocommerce",
    readOnly: false,
    async searchProducts({ query, limit }) {
      const code = await shopCurrency();
      const params: Record<string, string> = { per_page: String(limit), status: "publish" };
      if (query?.trim()) params.search = query.trim();
      const rows = await listProducts(params);
      return rows.map((row) => toSummary(mapProduct(row, code)));
    },
    async getProduct(id) {
      return (await readProduct(id)).product;
    },
    async getOrder(id) {
      let payload: unknown;
      try {
        payload = await request(`orders/${encodeURIComponent(id)}`);
      } catch (error) {
        if (error instanceof StoreError && error.status === 404) {
          throw new StoreError(`Order ${id} not found`, 404, "not_found");
        }
        throw error;
      }
      const parsed = wooOrderSchema.safeParse(payload);
      if (!parsed.success)
        throw new StoreError("Unexpected order payload", undefined, "bad_response");
      const order = parsed.data;
      const code = order.currency;
      if (!/^[A-Z]{3}$/.test(code))
        throw new StoreError("Unexpected order currency", undefined, "bad_response");
      return {
        id: String(order.id),
        status: order.status,
        total: { amount: parseAmount(order.total), currency: code },
        customerEmail: order.billing?.email?.trim() ? order.billing.email : null,
        createdAt: order.date_created_gmt,
        lineItems: order.line_items.map((item) => ({
          productId: String(item.product_id),
          name: item.name,
          quantity: item.quantity,
          total: { amount: parseAmount(item.total), currency: code },
        })),
      };
    },
    async listLowStock({ threshold, limit }) {
      // ponytail: first 100 published products, filtered locally. Upgrade path: the Woo stock report, or a stock_quantity query, once a shop outgrows one page.
      const code = await shopCurrency();
      const rows = await listProducts({ per_page: "100", status: "publish" });
      const items: StockItem[] = [];
      for (const row of rows) {
        const product = mapProduct(row, code);
        if (product.stockQuantity === null || product.stockQuantity > threshold) continue;
        items.push({
          productId: product.id,
          name: product.name,
          sku: product.sku,
          stockQuantity: product.stockQuantity,
          lowStockThreshold: threshold,
        });
        if (items.length >= limit) break;
      }
      return items;
    },
    async updateProductPrice(id, price) {
      await readProduct(id);
      const payload = await request(`products/${encodeURIComponent(id)}`, undefined, "PUT", {
        regular_price: price,
        sale_price: "",
      });
      return mapWrite(payload, await shopCurrency(), id);
    },
    async updateProductSeo(id, seo) {
      const current = await readProduct(id);
      const meta: Array<{ id?: number; key: string; value: string }> = [];
      if (seo.seoTitle !== undefined)
        meta.push(upsertMeta(current.raw.meta_data, WRITE_TITLE_KEY, seo.seoTitle));
      if (seo.seoDescription !== undefined) {
        meta.push(upsertMeta(current.raw.meta_data, WRITE_DESCRIPTION_KEY, seo.seoDescription));
      }
      const payload = await request(`products/${encodeURIComponent(id)}`, undefined, "PUT", {
        meta_data: meta,
      });
      return mapWrite(payload, await shopCurrency(), id);
    },
    async updateStock(id, stockQuantity) {
      await readProduct(id);
      const payload = await request(`products/${encodeURIComponent(id)}`, undefined, "PUT", {
        manage_stock: true,
        stock_quantity: stockQuantity,
      });
      return mapWrite(payload, await shopCurrency(), id);
    },
  };
}

function mapWrite(payload: unknown, currency: string, id: string): Product {
  const parsed = wooProductSchema.safeParse(payload);
  if (!parsed.success)
    throw new StoreError(
      `Unexpected payload after updating product ${id}`,
      undefined,
      "bad_response",
    );
  const amount = parsed.data.price !== "" ? parsed.data.price : parsed.data.regular_price;
  return productSchema.parse({
    id: String(parsed.data.id),
    name: parsed.data.name,
    sku: parsed.data.sku.trim() ? parsed.data.sku : null,
    price: { amount: parseAmount(amount), currency },
    stockQuantity: parsed.data.manage_stock ? (parsed.data.stock_quantity ?? null) : null,
    status: parsed.data.status,
    description: parsed.data.description.trim() ? parsed.data.description : null,
    seoTitle: metaText(parsed.data.meta_data, SEO_TITLE_KEYS),
    seoDescription: metaText(parsed.data.meta_data, SEO_DESCRIPTION_KEYS),
    permalink: parsed.data.permalink?.trim() ? parsed.data.permalink : null,
    updatedAt: parsed.data.date_modified_gmt ?? null,
  });
}

function toSummary(product: Product): ProductSummary {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    price: product.price,
    stockQuantity: product.stockQuantity,
    status: product.status,
  };
}

function metaText(meta: Meta[], keys: readonly string[]): string | null {
  for (const key of keys) {
    const found = meta.find((entry) => entry.key === key);
    if (typeof found?.value === "string" && found.value.trim()) return found.value;
    if (typeof found?.value === "number") return String(found.value);
  }
  return null;
}

function upsertMeta(
  meta: Meta[],
  key: string,
  value: string,
): { id?: number; key: string; value: string } {
  const existing = meta.find((entry) => entry.key === key);
  return existing?.id === undefined ? { key, value } : { id: existing.id, key, value };
}
