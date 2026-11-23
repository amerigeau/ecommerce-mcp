import { http, HttpResponse, type RequestHandler } from "msw";
import { describe, expect, it } from "vitest";
import { createWooCommerceAdapter } from "../src/adapters/woocommerce.js";
import { server } from "./msw.js";

const BASE = "https://shop.example.test";
const KEY = "ck_test_only";
const SECRET = "cs_test_only_secret";

function adapter() {
  return createWooCommerceAdapter({
    url: BASE,
    consumerKey: KEY,
    consumerSecret: SECRET,
  });
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: "Speckled mug",
    sku: "MUG-001",
    permalink: "https://shop.example.test/product/mug",
    status: "publish",
    price: "18.00",
    regular_price: "18.00",
    sale_price: "",
    description: "A fake mug",
    manage_stock: true,
    stock_quantity: 3,
    date_modified_gmt: "2026-01-15T09:00:00",
    meta_data: [{ id: 9, key: "seo_title", value: "Old title" }],
    ...overrides,
  };
}

function useShop(handlers: RequestHandler[]) {
  server.use(
    http.get(`${BASE}/wp-json/wc/v3/settings/general/woocommerce_currency`, () =>
      HttpResponse.json({ id: "woocommerce_currency", value: "EUR" }),
    ),
    ...handlers,
  );
}

describe("woocommerce adapter", () => {
  it("searches products with basic auth and no secret in the URL", async () => {
    let authorization = "";
    let url = "";
    useShop([
      http.get(`${BASE}/wp-json/wc/v3/products`, ({ request }) => {
        authorization = request.headers.get("authorization") ?? "";
        url = request.url;
        return HttpResponse.json([
          product(),
          product({ id: 11, name: "Tote", sku: "TOTE-004", price: "32.00" }),
        ]);
      }),
    ]);

    const products = await adapter().searchProducts({ query: "mug", limit: 20 });
    expect(products.map((item) => item.sku)).toEqual(["MUG-001", "TOTE-004"]);
    expect(products[0]?.price).toEqual({ amount: "18.00", currency: "EUR" });
    expect(authorization).toBe(`Basic ${Buffer.from(`${KEY}:${SECRET}`).toString("base64")}`);
    expect(url).not.toContain(SECRET);
    expect(url).toContain("search=mug");
  });

  it("reads a product, including SEO meta, and an order", async () => {
    useShop([
      http.get(`${BASE}/wp-json/wc/v3/products/:id`, () => HttpResponse.json(product())),
      http.get(`${BASE}/wp-json/wc/v3/orders/:id`, () =>
        HttpResponse.json({
          id: 1001,
          status: "processing",
          currency: "EUR",
          total: "36.00",
          billing: { email: "buyer@example.com" },
          date_created_gmt: "2026-04-04T10:30:00",
          line_items: [{ product_id: 10, name: "Speckled mug", quantity: 2, total: "36.00" }],
        }),
      ),
    ]);
    const shop = adapter();
    const found = await shop.getProduct("10");
    expect(found.seoTitle).toBe("Old title");
    expect(found.stockQuantity).toBe(3);
    const order = await shop.getOrder("1001");
    expect(order.customerEmail).toBe("buyer@example.com");
    expect(order.lineItems[0]?.quantity).toBe(2);
  });

  it("lists low stock from the first page", async () => {
    useShop([
      http.get(`${BASE}/wp-json/wc/v3/products`, () =>
        HttpResponse.json([
          product({ id: 1, stock_quantity: 2, sku: "LOW" }),
          product({ id: 2, manage_stock: false, stock_quantity: 0, sku: "UNTRACKED" }),
          product({ id: 3, stock_quantity: 40, sku: "FULL" }),
        ]),
      ),
    ]);
    const items = await adapter().listLowStock({ threshold: 5, limit: 20 });
    expect(items.map((item) => item.sku)).toEqual(["LOW"]);
  });

  it("updates price, seo, and stock", async () => {
    const bodies: unknown[] = [];
    useShop([
      http.get(`${BASE}/wp-json/wc/v3/products/:id`, () => HttpResponse.json(product())),
      http.put(`${BASE}/wp-json/wc/v3/products/:id`, async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        return HttpResponse.json({
          ...product(),
          ...(body as object),
          price: "21.00",
          regular_price: "21.00",
        });
      }),
    ]);
    const shop = adapter();
    const priced = await shop.updateProductPrice("10", "21.00");
    expect(priced.price.amount).toBe("21.00");
    expect(bodies[0]).toEqual({ regular_price: "21.00", sale_price: "" });

    await shop.updateProductSeo("10", { seoTitle: "New title" });
    expect(bodies[1]).toEqual({ meta_data: [{ id: 9, key: "seo_title", value: "New title" }] });

    await shop.updateStock("10", 8);
    expect(bodies[2]).toEqual({ manage_stock: true, stock_quantity: 8 });
  });

  it("redacts secrets from store error bodies", async () => {
    useShop([
      http.get(`${BASE}/wp-json/wc/v3/products`, () =>
        HttpResponse.json({ message: `bad key ${SECRET}` }, { status: 401 }),
      ),
    ]);
    let message = "";
    try {
      await adapter().searchProducts({ limit: 5 });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("401");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain(KEY);
  });
});
