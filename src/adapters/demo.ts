import { StoreError } from "../http.js";
import type { Order, Product, ProductSummary } from "../schemas.js";
import type { StoreAdapter } from "./StoreAdapter.js";

const products: Product[] = [
  {
    id: "mug-1",
    name: "Speckled ceramic mug",
    sku: "MUG-001",
    price: { amount: "18.00", currency: "EUR" },
    stockQuantity: 3,
    status: "publish",
    description: "Fake mug shipped with the demo adapter.",
    seoTitle: "Speckled ceramic mug",
    seoDescription: "Demo catalog item.",
    permalink: null,
    updatedAt: "2026-01-15T09:00:00.000Z",
  },
  {
    id: "tote-4",
    name: "Linen tote",
    sku: "TOTE-004",
    price: { amount: "32.00", currency: "EUR" },
    stockQuantity: 0,
    status: "publish",
    description: "Fake tote. Stock is zero so low-stock queries return it.",
    seoTitle: null,
    seoDescription: null,
    permalink: null,
    updatedAt: "2026-02-02T09:00:00.000Z",
  },
  {
    id: "coast-2",
    name: "Oak coaster set",
    sku: "COAST-2",
    price: { amount: "14.50", currency: "EUR" },
    stockQuantity: 40,
    status: "publish",
    description: "Four fake coasters.",
    seoTitle: "Oak coaster set",
    seoDescription: null,
    permalink: null,
    updatedAt: "2026-03-01T09:00:00.000Z",
  },
];

const orders: Order[] = [
  {
    id: "1001",
    status: "processing",
    total: { amount: "36.00", currency: "EUR" },
    customerEmail: "buyer@example.com",
    createdAt: "2026-04-04T10:30:00.000Z",
    lineItems: [
      {
        productId: "mug-1",
        name: "Speckled ceramic mug",
        quantity: 2,
        total: { amount: "36.00", currency: "EUR" },
      },
    ],
  },
];

function summary(product: Product): ProductSummary {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    price: product.price,
    stockQuantity: product.stockQuantity,
    status: product.status,
  };
}

function refuse(): never {
  throw new StoreError("The demo store is read-only", undefined, "read_only");
}

export function createDemoAdapter(): StoreAdapter {
  return {
    type: "demo",
    readOnly: true,
    async searchProducts({ query, limit }) {
      const needle = query?.trim().toLowerCase();
      const matched = products.filter((product) => {
        if (!needle) return true;
        return (
          product.name.toLowerCase().includes(needle) ||
          (product.sku?.toLowerCase().includes(needle) ?? false)
        );
      });
      return matched.slice(0, limit).map((product) => structuredClone(summary(product)));
    },
    async getProduct(id) {
      const product = products.find((item) => item.id === id);
      if (!product) throw new StoreError(`Product ${id} not found`, 404, "not_found");
      return structuredClone(product);
    },
    async getOrder(id) {
      const order = orders.find((item) => item.id === id);
      if (!order) throw new StoreError(`Order ${id} not found`, 404, "not_found");
      return structuredClone(order);
    },
    async listLowStock({ threshold, limit }) {
      return products
        .filter((product) => product.stockQuantity !== null && product.stockQuantity <= threshold)
        .sort((a, b) => (a.stockQuantity ?? 0) - (b.stockQuantity ?? 0))
        .slice(0, limit)
        .map((product) => ({
          productId: product.id,
          name: product.name,
          sku: product.sku,
          stockQuantity: product.stockQuantity ?? 0,
          lowStockThreshold: threshold,
        }));
    },
    async updateProductPrice() {
      refuse();
    },
    async updateProductSeo() {
      refuse();
    },
    async updateStock() {
      refuse();
    },
  };
}
