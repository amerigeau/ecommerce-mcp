import { StoreError } from "./http.js";

const INPUT_AMOUNT = /^\d+(\.\d{1,2})?$/;
const STORE_AMOUNT = /^\d+(\.\d+)?$/;

export function normalizeAmount(value: string): string {
  if (!INPUT_AMOUNT.test(value)) {
    throw new StoreError(
      "Price must be a positive number with up to 2 decimals",
      undefined,
      "bad_response",
    );
  }
  return Number(value).toFixed(2);
}

export function parseAmount(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value.toFixed(2);
  }
  if (typeof value === "string" && STORE_AMOUNT.test(value.trim())) {
    return Number(value).toFixed(2);
  }
  throw new StoreError("Invalid price from the store", undefined, "bad_response");
}

export function multiplyAmount(amount: string, quantity: number): string {
  const [whole = "0", frac = "00"] = amount.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  return ((cents * quantity) / 100).toFixed(2);
}
