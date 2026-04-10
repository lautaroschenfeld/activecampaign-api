import type { ContactSyncRequest, NormalizedContactSyncRequest } from "../types/api";
import { normalizeEmail } from "./email";
import { normalizePhone } from "./phone";

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeOptionalString(value: string | undefined, collapse = false): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = collapse ? collapseWhitespace(value) : value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeContactSyncInput(input: ContactSyncRequest): NormalizedContactSyncRequest {
  const listIds = Array.from(
    new Set(input.list_ids.filter((value) => Number.isInteger(value) && value > 0))
  );
  const tagIds = input.tag_ids
    ? Array.from(new Set(input.tag_ids.filter((value) => Number.isInteger(value) && value > 0)))
    : undefined;

  return {
    email: normalizeEmail(input.email),
    first_name: normalizeOptionalString(input.first_name, true),
    last_name: normalizeOptionalString(input.last_name, true),
    phone: normalizePhone(input.phone),
    country: normalizeOptionalString(input.country),
    consent: input.consent,
    list_ids: listIds,
    tag_ids: tagIds && tagIds.length > 0 ? tagIds : undefined,
    utm_source: normalizeOptionalString(input.utm_source),
    utm_medium: normalizeOptionalString(input.utm_medium),
    utm_campaign: normalizeOptionalString(input.utm_campaign),
    utm_content: normalizeOptionalString(input.utm_content),
    utm_term: normalizeOptionalString(input.utm_term),
    page_url: normalizeOptionalString(input.page_url),
    referrer: normalizeOptionalString(input.referrer)
  };
}
