import type { Order, Product, ProductSummary, StockItem } from "../schemas.js";

export interface StoreAdapter {
  readonly type: "woocommerce" | "prestashop" | "demo";
  readonly readOnly: boolean;
  searchProducts(input: { query?: string; limit: number }): Promise<ProductSummary[]>;
  getProduct(id: string): Promise<Product>;
  getOrder(id: string): Promise<Order>;
  listLowStock(input: { threshold: number; limit: number }): Promise<StockItem[]>;
  updateProductPrice(id: string, price: string): Promise<Product>;
  updateProductSeo(
    id: string,
    seo: { seoTitle?: string; seoDescription?: string },
  ): Promise<Product>;
  updateStock(id: string, stockQuantity: number): Promise<Product>;
}
