import { applyColumnMapping, validateColumnMapping } from '../domain/column-mapping';
import { ImportFileError } from '../domain/errors';
import type {
  PreparedProductImport,
  PrepareProductImportInput,
} from '../domain/import-wizard-types';
import { normalizeMappedRow } from '../domain/normalization';

export function prepareProductImport(input: PrepareProductImportInput): PreparedProductImport {
  validateColumnMapping(input.inspection.headers, input.mapping);
  const hasOpeningQuantity = input.mapping.some(
    ({ targetField }) => targetField === 'opening_quantity',
  );
  if (input.mode === 'MASTER_DATA_IMPORT' && hasOpeningQuantity) {
    throw new ImportFileError(
      'INVALID_COLUMN_MAPPING',
      'Quantidade atual não pertence à importação de cadastro. Use reconciliação de estoque.',
    );
  }

  const rows = input.inspection.rows.map((row) => {
    const normalized = normalizeMappedRow(
      applyColumnMapping(row.rawData, input.mapping),
      row.rowNumber,
      input.valueMappings ? { valueMappings: input.valueMappings } : {},
    );
    return {
      rowNumber: row.rowNumber,
      rawData: row.rawData,
      normalizedData: normalized.data,
      validationErrors: normalized.issues,
      ignored: normalized.ignored,
    };
  });

  return {
    rows,
    summary: {
      total: rows.length,
      valid: rows.filter((row) => !row.ignored && row.validationErrors.length === 0).length,
      warnings: 0,
      errors: rows.filter((row) => !row.ignored && row.validationErrors.length > 0).length,
      conflicts: 0,
      ignored: rows.filter((row) => row.ignored).length,
    },
  };
}
