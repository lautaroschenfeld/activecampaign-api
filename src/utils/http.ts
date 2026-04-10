import { createHash } from "node:crypto";

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObject(item));
  }

  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortObject(source[key]);
        return accumulator;
      }, {});
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

export function createRequestFingerprint(method: string, path: string, body: unknown): string {
  const canonical = `${method.toUpperCase()}:${path}:${stableStringify(body)}`;
  return createHash("sha256").update(canonical).digest("hex");
}

export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }

  return /^application\/(?:[a-z0-9.+-]+\+)?json\b/i.test(contentType);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
