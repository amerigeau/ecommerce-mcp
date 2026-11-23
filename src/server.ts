import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { StoreAdapter } from "./adapters/StoreAdapter.js";
import { ChangeError, createChangeBook, type ChangeBook } from "./changes.js";
import { StoreError } from "./http.js";
import {
  applyInputSchema,
  applyOutputSchema,
  idInputSchema,
  lowStockInputSchema,
  lowStockOutputSchema,
  orderOutputSchema,
  previewFieldsSchema,
  previewInputSchema,
  previewOutputSchema,
  productOutputSchema,
  searchInputSchema,
  searchOutputSchema,
} from "./schemas.js";

const DEFAULT_LIMIT = 20;
const DEFAULT_THRESHOLD = 5;

type ToolResult =
  | { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> }
  | { content: Array<{ type: "text"; text: string }>; isError: true };

export function createMcpServer(options: {
  adapter: StoreAdapter;
  writesEnabled: boolean;
  now?: () => number;
  ttlMs?: number;
  book?: ChangeBook;
}): McpServer {
  const server = new McpServer({ name: "ecommerce-mcp", version: "0.1.0" });
  const adapter = options.adapter;
  const book =
    options.book ??
    createChangeBook({
      adapter,
      readOnly: !options.writesEnabled || adapter.readOnly,
      now: options.now,
      ttlMs: options.ttlMs,
    });

  server.registerTool(
    "search_products",
    {
      description: "Search the catalog by name or SKU. Omit query to list products.",
      inputSchema: searchInputSchema,
      outputSchema: searchOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const products = await adapter.searchProducts({
          query: args.query,
          limit: args.limit ?? DEFAULT_LIMIT,
        });
        return json(searchOutputSchema, { products });
      }),
  );

  server.registerTool(
    "get_product",
    {
      description: "Fetch one product, including price, stock, and SEO fields.",
      inputSchema: idInputSchema,
      outputSchema: productOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guard(async () => json(productOutputSchema, { product: await adapter.getProduct(args.id) })),
  );

  server.registerTool(
    "get_order",
    {
      description: "Fetch one order and its line items.",
      inputSchema: idInputSchema,
      outputSchema: orderOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guard(async () => json(orderOutputSchema, { order: await adapter.getOrder(args.id) })),
  );

  server.registerTool(
    "list_low_stock",
    {
      description: "List products whose stock is at or below a threshold. Default threshold is 5.",
      inputSchema: lowStockInputSchema,
      outputSchema: lowStockOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const threshold = args.threshold ?? DEFAULT_THRESHOLD;
        const items = await adapter.listLowStock({
          threshold,
          limit: args.limit ?? DEFAULT_LIMIT,
        });
        return json(lowStockOutputSchema, { threshold, items });
      }),
  );

  if (!book.readOnly) {
    server.registerTool(
      "preview_change",
      {
        description:
          "Prepare a price, SEO, or stock change. Writes nothing. Returns a changeId and the before/after diff. The id expires after 10 minutes.",
        inputSchema: previewFieldsSchema,
        outputSchema: previewOutputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) =>
        guard(async () => {
          const parsed = previewInputSchema.safeParse(args);
          if (!parsed.success) {
            throw new ChangeError(
              "unknown",
              parsed.error.issues.map((issue) => issue.message).join("; "),
            );
          }
          return json(previewOutputSchema, await book.preview(parsed.data));
        }),
    );

    server.registerTool(
      "apply_change",
      {
        description:
          "Apply a change returned by preview_change. Refuses when the id is expired or the product changed since the preview. Re-reads the product and reports verified.",
        inputSchema: applyInputSchema,
        outputSchema: applyOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (args) => guard(async () => json(applyOutputSchema, await book.apply(args.changeId))),
    );
  }

  return server;
}

function json<T extends z.ZodTypeAny>(schema: T, value: z.infer<T>): ToolResult {
  const parsed: unknown = schema.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StoreError("Unexpected store payload", undefined, "bad_response");
  }
  return {
    content: [{ type: "text", text: JSON.stringify(parsed) }],
    structuredContent: parsed as Record<string, unknown>,
  };
}

async function guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    return {
      content: [{ type: "text", text: publicMessage(error) }],
      isError: true,
    };
  }
}

function publicMessage(error: unknown): string {
  if (error instanceof ChangeError || error instanceof StoreError) return error.message;
  if (error instanceof z.ZodError) return "Unexpected store payload";
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected error";
}
