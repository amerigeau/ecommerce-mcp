import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("defaults to the demo store, read-only", () => {
    expect(loadConfig({})).toEqual({ storeType: "demo", readOnly: true });
  });

  it("rejects a store URL that embeds a secret, without echoing it", () => {
    const secret = "cs_super_secret_value";
    expect(() =>
      loadConfig({
        STORE_TYPE: "woocommerce",
        READ_ONLY: "false",
        WOOCOMMERCE_URL: `https://user:${secret}@shop.example.test`,
        WOOCOMMERCE_CONSUMER_KEY: "ck_test_only",
        WOOCOMMERCE_CONSUMER_SECRET: "cs_test_only",
      }),
    ).toThrow(/must not include credentials/);

    try {
      loadConfig({
        STORE_TYPE: "woocommerce",
        WOOCOMMERCE_URL: `https://user:${secret}@shop.example.test`,
        WOOCOMMERCE_CONSUMER_KEY: "ck_test_only",
        WOOCOMMERCE_CONSUMER_SECRET: "cs_test_only",
      });
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(secret);
    }
  });

  it("requires WooCommerce credentials and keeps them off the error text", () => {
    const secret = "cs_absent_secret";
    expect(() =>
      loadConfig({
        STORE_TYPE: "woocommerce",
        WOOCOMMERCE_URL: "https://shop.example.test",
        WOOCOMMERCE_CONSUMER_KEY: "ck_test_only",
        WOOCOMMERCE_CONSUMER_SECRET: "",
        UNRELATED: secret,
      }),
    ).toThrow(/WOOCOMMERCE_CONSUMER_SECRET: required/);
  });
});
