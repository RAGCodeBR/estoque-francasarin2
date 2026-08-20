import { isValidGtin } from '../../../utils/gtin';

import type { MappedImportData } from './column-mapping';
import type {
  ImportTargetField,
  ImportValueMappings,
  NormalizedImportData,
  ValidationIssue,
} from './types';
import {
  compileValueMapping,
  DEFAULT_VALUE_MAPPINGS,
  normalizeMappingValue,
} from './value-mapping';

export interface NormalizationOptions {
  valueMappings?: Partial<ImportValueMappings>;
}

export interface NormalizationResult {
  data: NormalizedImportData;
  issues: readonly ValidationIssue[];
  ignored: boolean;
}

export function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ');
  return normalized === '' ? null : normalized;
}

export function normalizeSku(value: string | null | undefined): string | null {
  return normalizeText(value)?.toUpperCase() ?? null;
}

export function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
}

function normalizeQuantity(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)?.replaceAll(/\s/g, '');
  if (!normalized) return null;
  if (normalized.startsWith('-')) throw new Error('NEGATIVE_QUANTITY');

  const unsigned = normalized.startsWith('+') ? normalized.slice(1) : normalized;
  if (!/^\d+(?:[.,]\d+)?$/.test(unsigned)) throw new Error('INVALID_QUANTITY');

  const separatorPosition = Math.max(unsigned.lastIndexOf(','), unsigned.lastIndexOf('.'));
  const integerRaw = separatorPosition >= 0 ? unsigned.slice(0, separatorPosition) : unsigned;
  const fraction = separatorPosition >= 0 ? unsigned.slice(separatorPosition + 1) : '';
  const integer = integerRaw.replace(/^0+(?=\d)/, '');

  if (integer.length > 15) throw new Error('QUANTITY_PRECISION');
  if (fraction.length > 3) throw new Error('QUANTITY_SCALE');

  return `${integer || '0'}.${fraction.padEnd(3, '0')}`;
}

export function isValidEan(ean: string): boolean {
  return isValidGtin(ean);
}

function issue(
  rowNumber: number,
  code: string,
  field: ImportTargetField,
  value: string | null | undefined,
  problem: string,
  suggestedCorrection: string,
): ValidationIssue {
  return {
    code,
    severity: 'ERROR',
    rowNumber,
    field,
    value: value ?? null,
    problem,
    suggestedCorrection,
  };
}

function normalizeQuantityField(
  rowNumber: number,
  field: 'opening_quantity' | 'minimum_quantity',
  value: string | null | undefined,
  label: string,
  issues: ValidationIssue[],
): string | null {
  try {
    return normalizeQuantity(value);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_QUANTITY';
    const problems: Readonly<Record<string, string>> = {
      NEGATIVE_QUANTITY: `${label} não pode ser negativa.`,
      INVALID_QUANTITY: `${label} possui formato inválido.`,
      QUANTITY_PRECISION: `${label} excede 15 dígitos inteiros.`,
      QUANTITY_SCALE: `${label} excede 3 casas decimais.`,
    };
    issues.push(
      issue(
        rowNumber,
        code,
        field,
        value,
        problems[code] ?? problems.INVALID_QUANTITY ?? '',
        'Informe um número não negativo com até 15 dígitos inteiros e 3 casas decimais.',
      ),
    );
    return null;
  }
}

export function normalizeMappedRow(
  mapped: MappedImportData,
  rowNumber: number,
  options: NormalizationOptions = {},
): NormalizationResult {
  const ignored = Object.values(mapped).every((value) => normalizeText(value) === null);
  const issues: ValidationIssue[] = [];
  const unitMapping = compileValueMapping(DEFAULT_VALUE_MAPPINGS.unit, options.valueMappings?.unit);
  const productTypeMapping = compileValueMapping(
    DEFAULT_VALUE_MAPPINGS.productType,
    options.valueMappings?.productType,
  );
  const sku = normalizeSku(mapped.sku);
  const name = normalizeText(mapped.name);
  const category = normalizeText(mapped.category);
  const externalId = normalizeText(mapped.external_id);
  const eanSource = normalizeText(mapped.ean);
  const ean = eanSource?.replaceAll(/\s/g, '') ?? null;
  const unitSource = normalizeText(mapped.unit);
  const productTypeSource = normalizeText(mapped.product_type);
  const unit = unitSource ? (unitMapping.get(normalizeMappingValue(unitSource)) ?? null) : null;
  const productType = productTypeSource
    ? (productTypeMapping.get(normalizeMappingValue(productTypeSource)) ?? null)
    : null;
  let openingQuantity: string | null = null;
  let minimumQuantity: string | null = null;

  if (!ignored) {
    if (!sku) {
      issues.push(
        issue(
          rowNumber,
          'REQUIRED',
          'sku',
          mapped.sku,
          'SKU é obrigatório.',
          'Mapeie ou informe o código único do produto.',
        ),
      );
    }
    if (!name) {
      issues.push(
        issue(
          rowNumber,
          'REQUIRED',
          'name',
          mapped.name,
          'Nome é obrigatório.',
          'Informe o nome do produto.',
        ),
      );
    }
    if (!category) {
      issues.push(
        issue(
          rowNumber,
          'REQUIRED',
          'category',
          mapped.category,
          'Categoria é obrigatória.',
          'Informe uma categoria ou resolva o mapeamento da coluna.',
        ),
      );
    }
    if (!unitSource) {
      issues.push(
        issue(
          rowNumber,
          'REQUIRED',
          'unit',
          mapped.unit,
          'Unidade é obrigatória.',
          'Informe UN ou KG, ou configure um ValueMapping.',
        ),
      );
    } else if (!unit) {
      issues.push(
        issue(
          rowNumber,
          'UNEXPECTED_VALUE',
          'unit',
          unitSource,
          `Unidade não reconhecida: ${unitSource}`,
          'Associe o valor externo a UN ou KG em ValueMapping.',
        ),
      );
    }
    if (!productTypeSource) {
      issues.push(
        issue(
          rowNumber,
          'REQUIRED',
          'product_type',
          mapped.product_type,
          'Tipo de produto é obrigatório.',
          'Informe RAW ou FRACTIONATED, ou configure um ValueMapping.',
        ),
      );
    } else if (!productType) {
      issues.push(
        issue(
          rowNumber,
          'UNEXPECTED_VALUE',
          'product_type',
          productTypeSource,
          `Tipo de produto não reconhecido: ${productTypeSource}`,
          'Associe o valor externo a RAW ou FRACTIONATED em ValueMapping.',
        ),
      );
    }
    if (ean && !isValidEan(ean)) {
      issues.push(
        issue(
          rowNumber,
          'INVALID_EAN',
          'ean',
          eanSource,
          'EAN inválido ou com dígito verificador incorreto.',
          'Informe um GTIN-8, GTIN-12, GTIN-13 ou GTIN-14 válido, somente com dígitos.',
        ),
      );
    }

    openingQuantity = normalizeQuantityField(
      rowNumber,
      'opening_quantity',
      mapped.opening_quantity,
      'Quantidade atual',
      issues,
    );
    minimumQuantity = normalizeQuantityField(
      rowNumber,
      'minimum_quantity',
      mapped.minimum_quantity,
      'Quantidade mínima',
      issues,
    );
  }

  return {
    data: {
      sku,
      name,
      ean,
      external_id: externalId,
      opening_quantity: openingQuantity,
      minimum_quantity: minimumQuantity,
      unit,
      category,
      product_type: productType,
    },
    issues,
    ignored,
  };
}
