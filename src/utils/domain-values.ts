const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ');
  if (!normalized) throw new Error(`${field} é obrigatório.`);
  return normalized;
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ');
  return normalized || null;
}

export function normalizeSearch(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalText(value);
  return normalized ?? undefined;
}

export function assertUuid(value: string, field: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${field} deve ser um UUID válido.`);
  return normalized.toLowerCase();
}
