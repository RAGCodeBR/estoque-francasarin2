import { ImportFileError } from './errors';
import {
  IMPORT_TARGET_FIELDS,
  type ColumnMapping,
  type ImportTargetField,
  type RawImportData,
} from './types';

const REQUIRED_TARGET_FIELDS: readonly ImportTargetField[] = [
  'sku',
  'name',
  'unit',
  'category',
  'product_type',
];

export type MappedImportData = Readonly<Partial<Record<ImportTargetField, string | null>>>;

export function validateColumnMapping(
  headers: readonly string[],
  mapping: readonly ColumnMapping[],
): void {
  const headerSet = new Set(headers);
  const mappedSources = new Set<string>();
  const mappedTargets = new Set<ImportTargetField>();

  for (const entry of mapping) {
    if (!headerSet.has(entry.sourceColumn)) {
      throw new ImportFileError(
        'INVALID_COLUMN_MAPPING',
        `A coluna de origem não existe: ${entry.sourceColumn}`,
      );
    }

    if (mappedSources.has(entry.sourceColumn)) {
      throw new ImportFileError(
        'INVALID_COLUMN_MAPPING',
        `A coluna foi mapeada mais de uma vez: ${entry.sourceColumn}`,
      );
    }
    mappedSources.add(entry.sourceColumn);

    if (entry.targetField !== 'IGNORE') {
      if (!IMPORT_TARGET_FIELDS.includes(entry.targetField)) {
        throw new ImportFileError(
          'INVALID_COLUMN_MAPPING',
          `Campo de destino inválido: ${entry.targetField}`,
        );
      }

      if (mappedTargets.has(entry.targetField)) {
        throw new ImportFileError(
          'INVALID_COLUMN_MAPPING',
          `O destino foi utilizado por mais de uma coluna: ${entry.targetField}`,
        );
      }
      mappedTargets.add(entry.targetField);
    }
  }

  const undecidedHeaders = headers.filter((header) => !mappedSources.has(header));
  if (undecidedHeaders.length > 0) {
    throw new ImportFileError(
      'INVALID_COLUMN_MAPPING',
      'Toda coluna deve ser mapeada ou explicitamente ignorada.',
      { undecidedHeaders },
    );
  }

  const missingTargets = REQUIRED_TARGET_FIELDS.filter((target) => !mappedTargets.has(target));
  if (missingTargets.length > 0) {
    throw new ImportFileError('INVALID_COLUMN_MAPPING', 'Campos obrigatórios não foram mapeados.', {
      missingTargets,
    });
  }
}

export function applyColumnMapping(
  rawData: RawImportData,
  mapping: readonly ColumnMapping[],
): MappedImportData {
  const mapped: Partial<Record<ImportTargetField, string | null>> = {};

  for (const entry of mapping) {
    if (entry.targetField !== 'IGNORE') {
      mapped[entry.targetField] = rawData[entry.sourceColumn] ?? null;
    }
  }

  return mapped;
}
