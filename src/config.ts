import { z } from "zod";

const envSchema = z.object({
  STORE_TYPE: z.enum(["woocommerce", "prestashop", "demo"]).default("demo"),
  READ_ONLY: z
    .enum(["true", "false", "1", "0"], {
      errorMap: () => ({ message: "must be true or false" }),
    })
    .default("true"),
  WOOCOMMERCE_URL: z.string().optional(),
  WOOCOMMERCE_CONSUMER_KEY: z.string().optional(),
  WOOCOMMERCE_CONSUMER_SECRET: z.string().optional(),
  PRESTASHOP_URL: z.string().optional(),
  PRESTASHOP_API_KEY: z.string().optional(),
});

export type Config =
  | { storeType: "demo"; readOnly: boolean }
  | {
      storeType: "woocommerce";
      readOnly: boolean;
      url: string;
      consumerKey: string;
      consumerSecret: string;
    }
  | { storeType: "prestashop"; readOnly: boolean; url: string; apiKey: string };

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse({
    STORE_TYPE: blank(env.STORE_TYPE),
    READ_ONLY: blank(env.READ_ONLY),
    WOOCOMMERCE_URL: blank(env.WOOCOMMERCE_URL),
    WOOCOMMERCE_CONSUMER_KEY: blank(env.WOOCOMMERCE_CONSUMER_KEY),
    WOOCOMMERCE_CONSUMER_SECRET: blank(env.WOOCOMMERCE_CONSUMER_SECRET),
    PRESTASHOP_URL: blank(env.PRESTASHOP_URL),
    PRESTASHOP_API_KEY: blank(env.PRESTASHOP_API_KEY),
  });
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(message);
  }

  const readOnly = parsed.data.READ_ONLY === "true" || parsed.data.READ_ONLY === "1";
  if (parsed.data.STORE_TYPE === "woocommerce") {
    return {
      storeType: "woocommerce",
      readOnly,
      url: storeUrl(requireText(parsed.data.WOOCOMMERCE_URL, "WOOCOMMERCE_URL"), "WOOCOMMERCE_URL"),
      consumerKey: requireText(parsed.data.WOOCOMMERCE_CONSUMER_KEY, "WOOCOMMERCE_CONSUMER_KEY"),
      consumerSecret: requireText(
        parsed.data.WOOCOMMERCE_CONSUMER_SECRET,
        "WOOCOMMERCE_CONSUMER_SECRET",
      ),
    };
  }
  if (parsed.data.STORE_TYPE === "prestashop") {
    return {
      storeType: "prestashop",
      readOnly,
      url: storeUrl(requireText(parsed.data.PRESTASHOP_URL, "PRESTASHOP_URL"), "PRESTASHOP_URL"),
      apiKey: requireText(parsed.data.PRESTASHOP_API_KEY, "PRESTASHOP_API_KEY"),
    };
  }
  return { storeType: "demo", readOnly };
}

function blank(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function requireText(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name}: required`);
  return value;
}

function storeUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}: invalid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label}: http(s) only`);
  }
  if (url.username || url.password) {
    throw new Error(`${label}: must not include credentials`);
  }
  for (const param of ["consumer_key", "consumer_secret", "ws_key", "key", "secret"]) {
    if (url.searchParams.has(param)) throw new Error(`${label}: must not include ${param}`);
  }
  return url.toString();
}
