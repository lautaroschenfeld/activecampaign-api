export function normalizePhone(phone?: string): string | undefined {
  if (phone === undefined) {
    return undefined;
  }

  const trimmed = phone.trim();
  if (!trimmed) {
    return undefined;
  }

  const hasPlusPrefix = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return undefined;
  }

  return hasPlusPrefix ? `+${digits}` : digits;
}
