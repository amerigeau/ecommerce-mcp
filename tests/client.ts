import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function connectClient(server: McpServer): Promise<Client> {
  const client = new Client({ name: "ecommerce-mcp-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

export function resultText(result: unknown): { text: string; isError: boolean } {
  if (!result || typeof result !== "object") throw new Error("expected a text result");
  const record = result as { content?: unknown; isError?: unknown };
  const content = Array.isArray(record.content) ? record.content : [];
  const first = content[0] as { type?: string; text?: string } | undefined;
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("expected a text result");
  }
  return { text: first.text, isError: record.isError === true };
}
