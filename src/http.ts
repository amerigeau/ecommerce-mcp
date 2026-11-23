export type StoreErrorCode = "not_found" | "http" | "read_only" | "bad_response";

export class StoreError extends Error {
  readonly status: number | undefined;
  readonly code: StoreErrorCode;

  constructor(message: string, status: number | undefined, code: StoreErrorCode) {
    super(message);
    this.name = "StoreError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchJson(
  url: URL,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    secrets: string[];
    fetchImpl?: typeof fetch;
  },
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 404) {
      throw new StoreError("Not found", 404, "not_found");
    }
    const detail = redact(text, options.secrets).slice(0, 300);
    throw new StoreError(
      detail
        ? `Store request failed (${response.status}): ${detail}`
        : `Store request failed (${response.status})`,
      response.status,
      "http",
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StoreError("Store returned non-JSON", response.status, "bad_response");
  }
}

export function redact(text: string, secrets: string[]): string {
  return secrets.reduce((current, secret) => {
    if (!secret) return current;
    return current.split(secret).join("[redacted]");
  }, text);
}
