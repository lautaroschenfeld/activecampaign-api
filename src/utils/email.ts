import { createHash } from "node:crypto";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashEmail(email?: string): string | undefined {
  if (!email) {
    return undefined;
  }

  return createHash("sha256").update(email).digest("hex");
}
