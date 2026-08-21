export function formatDecimal(value: string, unit?: string): string {
  const amount = Number(value);
  const formatted = Number.isFinite(amount)
    ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(
        amount,
      )
    : value;
  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR');
}

export function createIdempotencyKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}
