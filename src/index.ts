#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDemoAdapter } from "./adapters/demo.js";
import { createPrestaShopAdapter } from "./adapters/prestashop.js";
import type { StoreAdapter } from "./adapters/StoreAdapter.js";
import { createWooCommerceAdapter } from "./adapters/woocommerce.js";
import { type Config, loadConfig } from "./config.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const adapter = createAdapter(config);
  const writes = !config.readOnly && !adapter.readOnly;
  console.error(`ecommerce-mcp store=${config.storeType} writes=${writes ? "on" : "off"}`);
  const server = createMcpServer({ adapter, writesEnabled: !config.readOnly });
  await server.connect(new StdioServerTransport());
}

function createAdapter(config: Config): StoreAdapter {
  if (config.storeType === "woocommerce") {
    return createWooCommerceAdapter({
      url: config.url,
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
    });
  }
  if (config.storeType === "prestashop") {
    return createPrestaShopAdapter({ url: config.url, apiKey: config.apiKey });
  }
  return createDemoAdapter();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Failed to start");
  process.exit(1);
});
