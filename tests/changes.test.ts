import { describe, expect, it } from "vitest";
import { CHANGE_TTL_MS, createChangeBook } from "../src/changes.js";
import { createMemoryAdapter } from "./memory-adapter.js";

describe("preview / apply / verify", () => {
  it("previews without writing, then applies and verifies the new price", async () => {
    const memory = createMemoryAdapter();
    const book = createChangeBook({ adapter: memory.adapter, readOnly: false });

    const preview = await book.preview({ kind: "price", productId: "mug-1", price: "21" });
    expect(memory.writes.count).toBe(0);
    expect(preview.before).toEqual({ price: "18.00" });
    expect(preview.after).toEqual({ price: "21.00" });
    expect(preview.lockedUpdatedAt).toBe("2026-01-01T00:00:00.000Z");

    const applied = await book.apply(preview.changeId);
    expect(applied.verified).toBe(true);
    expect(applied.product.price.amount).toBe("21.00");
    expect(memory.writes.count).toBe(1);
    expect(memory.products.get("mug-1")?.price.amount).toBe("21.00");

    await expect(book.apply(preview.changeId)).rejects.toThrow(/Unknown changeId/);
  });

  it("reports verified false when the write does not stick", async () => {
    const memory = createMemoryAdapter();
    const book = createChangeBook({
      adapter: {
        ...memory.adapter,
        async updateProductPrice(id, price) {
          await memory.adapter.updateProductPrice(id, price);
          const product = memory.products.get(id);
          if (!product) throw new Error("missing");
          product.price = { ...product.price, amount: "1.00" };
          return memory.adapter.getProduct(id);
        },
      },
      readOnly: false,
    });
    const preview = await book.preview({ kind: "price", productId: "mug-1", price: "21.00" });
    const applied = await book.apply(preview.changeId);
    expect(applied.verified).toBe(false);
    expect(applied.product.price.amount).toBe("1.00");
  });

  it("refuses a stale preview when the price moved", async () => {
    const memory = createMemoryAdapter();
    const book = createChangeBook({ adapter: memory.adapter, readOnly: false });
    const preview = await book.preview({ kind: "price", productId: "mug-1", price: "21.00" });
    const product = memory.products.get("mug-1");
    if (!product) throw new Error("missing");
    product.price = { ...product.price, amount: "19.00" };

    await expect(book.apply(preview.changeId)).rejects.toThrow(/preview again/);
    expect(memory.writes.count).toBe(0);
  });

  it("refuses a stale preview when only updatedAt moved", async () => {
    const memory = createMemoryAdapter();
    const book = createChangeBook({ adapter: memory.adapter, readOnly: false });
    const preview = await book.preview({ kind: "price", productId: "mug-1", price: "21.00" });
    const product = memory.products.get("mug-1");
    if (!product) throw new Error("missing");
    product.updatedAt = "2026-06-01T00:00:00.000Z";

    await expect(book.apply(preview.changeId)).rejects.toThrow(/Product changed since preview/);
    expect(memory.writes.count).toBe(0);
  });

  it("refuses an expired changeId", async () => {
    let now = 1_000;
    const memory = createMemoryAdapter();
    const book = createChangeBook({
      adapter: memory.adapter,
      readOnly: false,
      now: () => now,
      ttlMs: CHANGE_TTL_MS,
    });
    const preview = await book.preview({ kind: "price", productId: "mug-1", price: "21.00" });
    now += CHANGE_TTL_MS;
    await expect(book.apply(preview.changeId)).rejects.toThrow("Change expired");
    expect(memory.writes.count).toBe(0);
  });

  it("refuses writes in read-only mode", async () => {
    const memory = createMemoryAdapter();
    const book = createChangeBook({ adapter: memory.adapter, readOnly: true });
    await expect(
      book.preview({ kind: "price", productId: "mug-1", price: "21.00" }),
    ).rejects.toThrow(/Writes are disabled/);
    await expect(book.apply("00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      /Writes are disabled/,
    );
    expect(memory.writes.count).toBe(0);
  });
});
