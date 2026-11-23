import type { StoreAdapter } from "../src/adapters/StoreAdapter.js";
import type { Order, Product } from "../src/schemas.js";

export function createMemoryAdapter(): {
  adapter: StoreAdapter;
  products: Map<string, Product>;
  writes: { count: number };
} {
  let tick = 0;
  const products = new Map<string, Product>([
    [
      "mug-1",
      {
        id: "mug-1",
        name: "Speckled ceramic mug",
        sku: "MUG-001",
        price: { amount: "18.00", currency: "EUR" },
        stockQuantity: 3,
        status: "publish",
        description: "Fake mug.",
        seoTitle: "Old title",
        seoDescription: "Old description",
        permalink: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ]);
  const orders = new Map<string, Order>();
  const writes = { count: 0 };

  function requireProduct(id: string): Product {
    const product = products.get(id);
    if (!product) throw new Error(`Product ${id} not found`);
    return product;
  }

  function touch(product: Product): Product {
    tick += 1;
    product.updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString();
    writes.count += 1;
    return structuredClone(product);
  }

  const adapter: StoreAdapter = {
    type: "demo",
    readOnly: false,
    async searchProducts({ limit }) {
      return [...products.values()].slice(0, limit).map((product) => structuredClone(product));
    },
    async getProduct(id) {
      return structuredClone(requireProduct(id));
    },
    async getOrder(id) {
      const order = orders.get(id);
      if (!order) throw new Error(`Order ${id} not found`);
      return structuredClone(order);
    },
    async listLowStock({ threshold, limit }) {
      return [...products.values()]
        .filter((product) => product.stockQuantity !== null && product.stockQuantity <= threshold)
        .slice(0, limit)
        .map((product) => ({
          productId: product.id,
          name: product.name,
          sku: product.sku,
          stockQuantity: product.stockQuantity ?? 0,
          lowStockThreshold: threshold,
        }));
    },
    async updateProductPrice(id, price) {
      const product = requireProduct(id);
      product.price = { ...product.price, amount: price };
      return touch(product);
    },
    async updateProductSeo(id, seo) {
      const product = requireProduct(id);
      if (seo.seoTitle !== undefined) product.seoTitle = seo.seoTitle;
      if (seo.seoDescription !== undefined) product.seoDescription = seo.seoDescription;
      return touch(product);
    },
    async updateStock(id, stockQuantity) {
      const product = requireProduct(id);
      product.stockQuantity = stockQuantity;
      return touch(product);
    },
  };

  return { adapter, products, writes };
}
