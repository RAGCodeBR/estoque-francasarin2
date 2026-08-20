const POSITIVE_NUMERIC_18_3 = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/;

export function normalizeStockQuantity(value: string): string {
  const normalized = value.trim();
  if (!POSITIVE_NUMERIC_18_3.test(normalized)) {
    throw new Error('Quantidade deve ser um NUMERIC(18,3) positivo.');
  }

  const [integer = '0', fraction = ''] = normalized.split('.');
  const result = `${integer}.${fraction.padEnd(3, '0')}`;
  if (result === '0.000') throw new Error('Quantidade deve ser maior que zero.');
  return result;
}
