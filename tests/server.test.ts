import { describe, expect, it } from "vitest";
import { createDemoAdapter } from "../src/adapters/demo.js";
import { createMcpServer } from "../src/server.js";
import { connectClient, resultText } from "./client.js";
import { createMemoryAdapter } from "./memory-adapter.js";

describe("mcp server", () => {
  it("serves the demo catalog and hides write tools", async () => {
    const client = await connectClient(
      createMcpServer({ adapter: createDemoAdapter(), writesEnabled: true }),
    );
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toEqual(["search_products", "get_product", "get_order", "list_low_stock"]);

    const search = resultText(
      await client.callTool({ name: "search_products", arguments: { query: "mug" } }),
    );
    expect(search.isError).toBe(false);
    expect(JSON.parse(search.text).products[0].sku).toBe("MUG-001");

    const low = resultText(
      await client.callTool({ name: "list_low_stock", arguments: { threshold: 5 } }),
    );
    const ids = JSON.parse(low.text).items.map((item: { productId: string }) => item.productId);
    expect(ids).toEqual(["tote-4", "mug-1"]);

    const order = resultText(
      await client.callTool({ name: "get_order", arguments: { id: "1001" } }),
    );
    expect(JSON.parse(order.text).order.customerEmail).toBe("buyer@example.com");
  });

  it("does not register write tools when READ_ONLY is on", async () => {
    const memory = createMemoryAdapter();
    const client = await connectClient(
      createMcpServer({ adapter: memory.adapter, writesEnabled: false }),
    );
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain("preview_change");
    expect(names).not.toContain("apply_change");
  });

  it("runs preview then apply through the tool API", async () => {
    const memory = createMemoryAdapter();
    const client = await connectClient(
      createMcpServer({ adapter: memory.adapter, writesEnabled: true }),
    );
    const preview = resultText(
      await client.callTool({
        name: "preview_change",
        arguments: { productId: "mug-1", kind: "price", price: "21.50" },
      }),
    );
    expect(preview.isError).toBe(false);
    expect(memory.writes.count).toBe(0);
    const changeId = JSON.parse(preview.text).changeId as string;

    const applied = resultText(
      await client.callTool({ name: "apply_change", arguments: { changeId } }),
    );
    const body = JSON.parse(applied.text) as {
      verified: boolean;
      product: { price: { amount: string } };
    };
    expect(applied.isError).toBe(false);
    expect(body.verified).toBe(true);
    expect(body.product.price.amount).toBe("21.50");
  });
});
