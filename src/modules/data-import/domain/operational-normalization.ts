import { isValidCnpj } from '../../../utils/cnpj';

import { isValidEan, normalizeQuantity, normalizeSku, normalizeText } from './normalization';
import type {
  OperationalImportType,
  OperationalNormalizedData,
  OperationalTargetField,
} from './operational-types';
import type { ImportValueMappings, ValidationIssue } from './types';
import {
  compileValueMapping,
  DEFAULT_VALUE_MAPPINGS,
  normalizeMappingValue,
} from './value-mapping';

export interface OperationalNormalizationResult {
  data: OperationalNormalizedData | null;
  issues: readonly ValidationIssue[];
  ignored: boolean;
}

function issue(
  rowNumber: number,
  field: OperationalTargetField,
  value: string | null | undefined,
  problem: string,
  suggestedCorrection: string,
): ValidationIssue {
  return {
    code: 'INVALID_OPERATIONAL_VALUE',
    severity: 'ERROR',
    rowNumber,
    field: field as ValidationIssue['field'],
    value: value ?? null,
    problem,
    suggestedCorrection,
  };
}

function quantity(
  rowNumber: number,
  field: 'minimum_quantity' | 'current_quantity',
  value: string | null | undefined,
  issues: ValidationIssue[],
): string | null {
  try {
    return normalizeQuantity(value);
  } catch {
    issues.push(
      issue(
        rowNumber,
        field,
        value,
        'Quantidade inválida, negativa ou com mais de três casas decimais.',
        'Informe um valor não negativo compatível com NUMERIC(18,3).',
      ),
    );
    return null;
  }
}

export function normalizeOperationalRow(
  importType: OperationalImportType,
  mapped: OperationalNormalizedData,
  rowNumber: number,
  valueMappings: Partial<ImportValueMappings> = {},
): OperationalNormalizationResult {
  const ignored = Object.values(mapped).every((value) => normalizeText(value) === null);
  if (ignored) return { data: null, issues: [], ignored: true };

  const issues: ValidationIssue[] = [];
  const output: Partial<Record<OperationalTargetField, string | null>> = {};
  const copyText = (field: OperationalTargetField): void => {
    output[field] = normalizeText(mapped[field]);
  };

  for (const field of ['name', 'description', 'category', 'legal_name', 'trade_name'] as const) {
    if (field in mapped) copyText(field);
  }
  if ('sku' in mapped) output.sku = normalizeSku(mapped.sku);
  if ('ean' in mapped) output.ean = normalizeText(mapped.ean)?.replaceAll(/\s/g, '') ?? null;
  if (output.ean && !isValidEan(output.ean)) {
    issues.push(
      issue(rowNumber, 'ean', output.ean, 'EAN/GTIN inválido.', 'Corrija ou deixe o EAN vazio.'),
    );
  }
  if ('document' in mapped) {
    const source = normalizeText(mapped.document);
    const digits = source?.replaceAll(/\D/g, '') ?? null;
    output.document = digits && isValidCnpj(digits) ? digits : null;
    if (source && !output.document) {
      issues.push(
        issue(rowNumber, 'document', source, 'CNPJ inválido.', 'Informe um CNPJ válido.'),
      );
    }
  }
  if ('minimum_quantity' in mapped) {
    output.minimum_quantity = quantity(
      rowNumber,
      'minimum_quantity',
      mapped.minimum_quantity,
      issues,
    );
  }
  if ('current_quantity' in mapped) {
    output.current_quantity = quantity(
      rowNumber,
      'current_quantity',
      mapped.current_quantity,
      issues,
    );
  }

  if ('unit' in mapped) {
    const source = normalizeText(mapped.unit);
    const map = compileValueMapping(DEFAULT_VALUE_MAPPINGS.unit, valueMappings.unit);
    output.unit = source ? (map.get(normalizeMappingValue(source)) ?? null) : null;
    if (source && !output.unit) {
      issues.push(
        issue(rowNumber, 'unit', source, 'Unidade não reconhecida.', 'Mapeie para UN ou KG.'),
      );
    }
  }
  if ('product_type' in mapped) {
    const source = normalizeText(mapped.product_type);
    const map = compileValueMapping(DEFAULT_VALUE_MAPPINGS.productType, valueMappings.productType);
    output.product_type = source ? (map.get(normalizeMappingValue(source)) ?? null) : null;
    if (source && !output.product_type) {
      issues.push(
        issue(
          rowNumber,
          'product_type',
          source,
          'Tipo de produto não reconhecido.',
          'Mapeie para RAW ou FRACTIONATED.',
        ),
      );
    }
  }
  if ('location_type' in mapped) {
    const source = normalizeText(mapped.location_type)?.toUpperCase() ?? null;
    output.location_type = source === 'STOCK' || source === 'CONSUMPTION' ? source : null;
    if (source && !output.location_type) {
      issues.push(
        issue(
          rowNumber,
          'location_type',
          source,
          'Tipo de local inválido.',
          'Informe STOCK ou CONSUMPTION.',
        ),
      );
    }
  }

  const required: Readonly<Record<OperationalImportType, readonly OperationalTargetField[]>> = {
    PRODUCTS: ['sku', 'name', 'category', 'product_type', 'unit', 'minimum_quantity'],
    CATEGORIES: ['name'],
    LOCATIONS: ['name', 'location_type'],
    SUPPLIERS: ['legal_name'],
    STOCK_RECONCILIATION: ['current_quantity'],
  };
  for (const field of required[importType]) {
    if (!output[field]) {
      issues.push(
        issue(rowNumber, field, mapped[field], 'Campo obrigatório ausente.', 'Informe um valor.'),
      );
    }
  }
  if (importType === 'STOCK_RECONCILIATION' && !output.sku && !output.ean) {
    issues.push(
      issue(
        rowNumber,
        'sku',
        null,
        'SKU ou EAN é obrigatório para identificar o produto.',
        'Informe pelo menos um identificador inequívoco.',
      ),
    );
  }

  return { data: output, issues, ignored: false };
}
