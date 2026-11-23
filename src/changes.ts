import { normalizeAmount } from "./money.js";
import type { FieldDiff, PreviewInput, PreviewResult, Product } from "./schemas.js";
import type { StoreAdapter } from "./adapters/StoreAdapter.js";

export const CHANGE_TTL_MS = 10 * 60 * 1000;

export type ChangeErrorCode = "read_only" | "expired" | "unknown" | "stale";

export class ChangeError extends Error {
  readonly code: ChangeErrorCode;

  constructor(code: ChangeErrorCode, message: string) {
    super(message);
    this.name = "ChangeError";
    this.code = code;
  }
}

interface PendingChange {
  id: string;
  expiresAt: number;
  productId: string;
  kind: PreviewInput["kind"];
  before: FieldDiff;
  after: FieldDiff;
  lockedUpdatedAt: string | null;
}

export interface ChangeBook {
  readonly readOnly: boolean;
  preview(input: PreviewInput): Promise<PreviewResult>;
  apply(changeId: string): Promise<{ changeId: string; verified: boolean; product: Product }>;
}

export function createChangeBook(options: {
  adapter: StoreAdapter;
  readOnly: boolean;
  now?: () => number;
  ttlMs?: number;
}): ChangeBook {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? CHANGE_TTL_MS;
  const pending = new Map<string, PendingChange>();

  function sweep(current: number): void {
    for (const [id, change] of pending) {
      if (change.expiresAt <= current) pending.delete(id);
    }
  }

  return {
    readOnly: options.readOnly,
    async preview(input) {
      if (options.readOnly) {
        throw new ChangeError(
          "read_only",
          "Writes are disabled. Set READ_ONLY=false for a WooCommerce or PrestaShop store. The demo adapter never writes.",
        );
      }
      sweep(now());
      const product = await options.adapter.getProduct(input.productId);
      const before: FieldDiff = {};
      const after: FieldDiff = {};
      if (input.kind === "price") {
        if (input.price === undefined) throw new ChangeError("unknown", "price is required");
        before.price = product.price.amount;
        after.price = normalizeAmount(input.price);
      } else if (input.kind === "seo") {
        if (input.seoTitle === undefined && input.seoDescription === undefined) {
          throw new ChangeError("unknown", "seoTitle or seoDescription is required");
        }
        if (input.seoTitle !== undefined) {
          before.seoTitle = product.seoTitle;
          after.seoTitle = input.seoTitle;
        }
        if (input.seoDescription !== undefined) {
          before.seoDescription = product.seoDescription;
          after.seoDescription = input.seoDescription;
        }
      } else {
        if (input.stockQuantity === undefined)
          throw new ChangeError("unknown", "stockQuantity is required");
        before.stockQuantity = product.stockQuantity;
        after.stockQuantity = input.stockQuantity;
      }
      const change: PendingChange = {
        id: crypto.randomUUID(),
        expiresAt: now() + ttlMs,
        productId: product.id,
        kind: input.kind,
        before,
        after,
        lockedUpdatedAt: product.updatedAt,
      };
      pending.set(change.id, change);
      return {
        changeId: change.id,
        expiresAt: new Date(change.expiresAt).toISOString(),
        productId: change.productId,
        kind: change.kind,
        before,
        after,
        lockedUpdatedAt: change.lockedUpdatedAt,
      };
    },
    async apply(changeId) {
      if (options.readOnly) {
        throw new ChangeError(
          "read_only",
          "Writes are disabled. Set READ_ONLY=false for a WooCommerce or PrestaShop store. The demo adapter never writes.",
        );
      }
      const currentTime = now();
      const change = pending.get(changeId);
      if (!change || change.expiresAt <= currentTime) {
        if (change) pending.delete(changeId);
        sweep(currentTime);
        throw new ChangeError(
          change ? "expired" : "unknown",
          change ? "Change expired" : "Unknown changeId",
        );
      }
      const current = await options.adapter.getProduct(change.productId);
      if (current.updatedAt !== change.lockedUpdatedAt || !sameFields(current, change.before)) {
        pending.delete(changeId);
        throw new ChangeError("stale", "Product changed since preview; preview again");
      }
      if (change.kind === "price") {
        if (change.after.price === undefined) throw new ChangeError("unknown", "Missing price");
        await options.adapter.updateProductPrice(change.productId, change.after.price);
      } else if (change.kind === "seo") {
        await options.adapter.updateProductSeo(change.productId, seoPatch(change.after));
      } else if (change.after.stockQuantity === undefined || change.after.stockQuantity === null) {
        throw new ChangeError("unknown", "Missing stock");
      } else {
        await options.adapter.updateStock(change.productId, change.after.stockQuantity);
      }
      pending.delete(change.id);
      const fresh = await options.adapter.getProduct(change.productId);
      return {
        changeId: change.id,
        verified: sameFields(fresh, change.after),
        product: fresh,
      };
    },
  };
}

function seoPatch(diff: FieldDiff): { seoTitle?: string; seoDescription?: string } {
  const patch: { seoTitle?: string; seoDescription?: string } = {};
  if (typeof diff.seoTitle === "string") patch.seoTitle = diff.seoTitle;
  if (typeof diff.seoDescription === "string") patch.seoDescription = diff.seoDescription;
  return patch;
}

function sameFields(product: Product, diff: FieldDiff): boolean {
  if (diff.price !== undefined && product.price.amount !== diff.price) return false;
  if (diff.seoTitle !== undefined && product.seoTitle !== diff.seoTitle) return false;
  if (diff.seoDescription !== undefined && product.seoDescription !== diff.seoDescription)
    return false;
  if (diff.stockQuantity !== undefined && product.stockQuantity !== diff.stockQuantity)
    return false;
  return true;
}
