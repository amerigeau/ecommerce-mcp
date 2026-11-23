import { http, HttpResponse, type RequestHandler } from "msw";
import { describe, expect, it } from "vitest";
import { createPrestaShopAdapter } from "../src/adapters/prestashop.js";
import { server } from "./msw.js";

const BASE = "https://shop.example.test";
const API_KEY = "PRESTA_TEST_KEY";

function adapter() {
  return createPrestaShopAdapter({ url: BASE, apiKey: API_KEY });
}

function productBody(price = "18.000000", title = "Old title") {
  return {
    product: {
      id: 10,
      reference: "MUG-001",
      price,
      active: "1",
      name: [{ id: "2", value: "Speckled mug" }],
      description: [{ id: "2", value: "A fake mug" }],
      meta_title: [{ id: "2", value: title }],
      meta_description: [{ id: "2", value: "Old description" }],
      date_upd: "2026-01-15 09:00:00",
      associations: {
        stock_availables: [{ id: "77", id_product_attribute: "0" }],
      },
    },
  };
}

function useShop(extra: RequestHandler[] = []) {
  server.use(
    http.get(`${BASE}/api/currencies`, () =>
      HttpResponse.json({ currencies: [{ id: "1", iso_code: "EUR", active: "1" }] }),
    ),
    http.get(`${BASE}/api/stock_availables/:id`, () =>
      HttpResponse.json({
        stock_available: { id: 77, id_product: 10, id_product_attribute: 0, quantity: 3 },
      }),
    ),
    ...extra,
  );
}

describe("prestashop adapter", () => {
  it("searches the first page and filters by name", async () => {
    let authorization = "";
    let url = "";
    useShop([
      http.get(`${BASE}/api/products`, ({ request }) => {
        authorization = request.headers.get("authorization") ?? "";
        url = request.url;
        return HttpResponse.json({
          products: [
            {
              id: 10,
              name: [{ id: "2", value: "Speckled mug" }],
              reference: "MUG-001",
              price: "18.00",
              active: "1",
            },
            {
              id: 11,
              name: [{ id: "2", value: "Linen tote" }],
              reference: "TOTE-004",
              price: "32.00",
              active: "1",
            },
          ],
        });
      }),
    ]);

    const products = await adapter().searchProducts({ query: "mug", limit: 20 });
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: "10",
      sku: "MUG-001",
      price: { amount: "18.00", currency: "EUR" },
      stockQuantity: null,
    });
    expect(authorization).toBe(`Basic ${Buffer.from(`${API_KEY}:`).toString("base64")}`);
    expect(url).not.toContain(API_KEY);
    expect(url).toContain("output_format=JSON");
  });

  it("reads a product with stock and an order without an email", async () => {
    useShop([
      http.get(`${BASE}/api/products/:id`, () => HttpResponse.json(productBody())),
      http.get(`${BASE}/api/orders/:id`, () =>
        HttpResponse.json({
          order: {
            id: 100,
            current_state: "2",
            total_paid: "36.000000",
            id_currency: "1",
            date_add: "2026-04-04 10:30:00",
            associations: {
              order_rows: [
                {
                  product_id: "10",
                  product_name: "Speckled mug",
                  product_quantity: "2",
                  product_price: "18.000000",
                },
              ],
            },
          },
        }),
      ),
    ]);
    const shop = adapter();
    const found = await shop.getProduct("10");
    expect(found.seoTitle).toBe("Old title");
    expect(found.stockQuantity).toBe(3);
    expect(found.updatedAt).toBe("2026-01-15 09:00:00");
    const order = await shop.getOrder("100");
    expect(order.customerEmail).toBeNull();
    expect(order.total.amount).toBe("36.00");
    expect(order.lineItems[0]?.total.amount).toBe("36.00");
  });

  it("lists low stock and skips combinations", async () => {
    let stockUrl = "";
    useShop([
      http.get(`${BASE}/api/stock_availables`, ({ request }) => {
        stockUrl = request.url;
        return HttpResponse.json({
          stock_availables: [
            { id: 1, id_product: 10, id_product_attribute: "0", quantity: "1" },
            { id: 2, id_product: 11, id_product_attribute: "5", quantity: "1" },
            { id: 3, id_product: 12, id_product_attribute: "0", quantity: "9" },
          ],
        });
      }),
      http.get(`${BASE}/api/products/:id`, () => HttpResponse.json(productBody())),
    ]);
    const items = await adapter().listLowStock({ threshold: 5, limit: 20 });
    expect(items.map((item) => item.stockQuantity)).toEqual([1]);
    expect(items[0]?.productId).toBe("10");
    expect(decodeURIComponent(stockUrl)).toContain("filter[quantity]=[0,5]");
    expect(decodeURIComponent(stockUrl)).toContain("filter[id_product_attribute]=[0]");
  });

  it("writes a partial product and keeps the language id", async () => {
    const bodies: unknown[] = [];
    let price = "18.000000";
    let title = "Old title";
    useShop([
      http.get(`${BASE}/api/products/:id`, () => HttpResponse.json(productBody(price, title))),
      http.put(`${BASE}/api/products/:id`, async ({ request }) => {
        const body = (await request.json()) as {
          product: { price?: string; meta_title?: Array<{ value: string }> };
        };
        bodies.push(body);
        if (body.product.price) price = body.product.price;
        const nextTitle = body.product.meta_title?.[0]?.value;
        if (nextTitle) title = nextTitle;
        return HttpResponse.json({ ok: true });
      }),
      http.put(`${BASE}/api/stock_availables/:id`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    ]);

    const shop = adapter();
    const priced = await shop.updateProductPrice("10", "21.00");
    expect(priced.price.amount).toBe("21.00");
    expect(bodies[0]).toEqual({ product: { id: "10", price: "21.00" } });

    const seo = await shop.updateProductSeo("10", { seoTitle: "New title" });
    expect(seo.seoTitle).toBe("New title");
    expect(bodies[1]).toEqual({
      product: { id: "10", meta_title: [{ id: "2", value: "New title" }] },
    });

    await shop.updateStock("10", 8);
    expect(bodies[2]).toEqual({
      stock_available: { id: "77", id_product: "10", id_product_attribute: "0", quantity: 8 },
    });
  });

  it("redacts the API key from error bodies", async () => {
    useShop([
      http.get(`${BASE}/api/products`, () =>
        HttpResponse.json({ message: `leaked ${API_KEY}` }, { status: 500 }),
      ),
    ]);
    let message = "";
    try {
      await adapter().searchProducts({ limit: 5 });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("500");
    expect(message).not.toContain(API_KEY);
  });
});
