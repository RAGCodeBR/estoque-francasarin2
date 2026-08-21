import { ImportFileError } from './errors';
import type {
  OperationalColumnMapping,
  OperationalImportType,
  OperationalNormalizedData,
  OperationalTargetField,
} from './operational-types';
import type { RawImportData } from './types';

const REQUIRED_FIELDS: Readonly<Record<OperationalImportType, readonly OperationalTargetField[]>> =
  {
    PRODUCTS: ['sku', 'name', 'category', 'product_type', 'unit', 'minimum_quantity'],
    CATEGORIES: ['name'],
    LOCATIONS: ['name', 'location_type'],
    SUPPLIERS: ['legal_name'],
    STOCK_RECONCILIATION: ['current_quantity'],
  };

const ALLOWED_FIELDS: Readonly<Record<OperationalImportType, readonly OperationalTargetField[]>> = {
  PRODUCTS: ['sku', 'ean', 'name', 'category', 'product_type', 'unit', 'minimum_quantity'],
  CATEGORIES: ['name', 'description'],
  LOCATIONS: ['name', 'description', 'location_type'],
  SUPPLIERS: ['document', 'legal_name', 'trade_name'],
  STOCK_RECONCILIATION: ['sku', 'ean', 'current_quantity'],
};

export function validateOperationalColumnMapping(
  importType: OperationalImportType,
  headers: readonly string[],
  mapping: readonly OperationalColumnMapping[],
): void {
  const headerSet = new Set(headers);
  const sources = new Set<string>();
  const targets = new Set<OperationalTargetField>();
  const allowed = new Set(ALLOWED_FIELDS[importType]);

  for (const entry of mapping) {
    if (!headerSet.has(entry.sourceColumn) || sources.has(entry.sourceColumn)) {
      throw new ImportFileError(
        'INVALID_COLUMN_MAPPING',
        `Coluna inexistente ou repetida: ${entry.sourceColumn}`,
      );
    }
    sources.add(entry.sourceColumn);
    if (entry.targetField === 'IGNORE') continue;
    if (!allowed.has(entry.targetField) || targets.has(entry.targetField)) {
      throw new ImportFileError(
        'INVALID_COLUMN_MAPPING',
        `Destino inválido ou repetido para ${importType}: ${entry.targetField}`,
      );
    }
    targets.add(entry.targetField);
  }

  const undecidedHeaders = headers.filter((header) => !sources.has(header));
  if (undecidedHeaders.length > 0) {
    throw new ImportFileError(
      'INVALID_COLUMN_MAPPING',
      'Toda coluna deve ser mapeada ou explicitamente ignorada.',
      { undecidedHeaders },
    );
  }

  const missingTargets = REQUIRED_FIELDS[importType].filter((field) => !targets.has(field));
  if (importType === 'STOCK_RECONCILIATION' && !targets.has('sku') && !targets.has('ean')) {
    missingTargets.push('sku');
  }
  if (missingTargets.length > 0) {
    throw new ImportFileError('INVALID_COLUMN_MAPPING', 'Campos obrigatórios não foram mapeados.', {
      missingTargets,
    });
  }
}

export function applyOperationalColumnMapping(
  rawData: RawImportData,
  mapping: readonly OperationalColumnMapping[],
): OperationalNormalizedData {
  const mapped: Partial<Record<OperationalTargetField, string | null>> = {};
  for (const entry of mapping) {
    if (entry.targetField !== 'IGNORE') {
      mapped[entry.targetField] = rawData[entry.sourceColumn] ?? null;
    }
  }
  return mapped;
}
