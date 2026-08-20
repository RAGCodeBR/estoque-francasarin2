import type { ProductType, UnitType } from './types';
import { isValidGtin } from '../../../utils/gtin';

export function assertProductType(value: unknown): ProductType {
  if (value !== 'RAW' && value !== 'FRACTIONATED') throw new Error('Tipo de produto inválido.');
  return value;
}

export function assertUnitType(value: unknown): UnitType {
  if (value !== 'UN' && value !== 'KG') throw new Error('Unidade inválida.');
  return value;
}

export function normalizeSku(value: string): string {
  const sku = value.normalize('NFKC').trim().toUpperCase();
  if (!sku) throw new Error('SKU é obrigatório.');
  return sku;
}

export function normalizeMinimumQuantity(value: string | undefined): string {
  const normalized = value?.trim();
  const quantity = normalized === undefined || normalized === '' ? '0' : normalized;
  if (!/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,3})?$/.test(quantity)) {
    throw new Error('Quantidade mínima deve ser um NUMERIC(18,3) não negativo.');
  }
  const [integer = '0', fraction = ''] = quantity.split('.');
  return `${integer}.${fraction.padEnd(3, '0')}`;
}

export function isValidEan(ean: string): boolean {
  return isValidGtin(ean);
}
