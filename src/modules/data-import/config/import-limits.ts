import type { ImportLimits } from '../domain/types';

export const DEFAULT_IMPORT_LIMITS: Readonly<ImportLimits> = Object.freeze({
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxRows: 10_000,
  maxColumns: 200,
  maxCellLength: 10_000,
  maxXlsxEntries: 5_000,
  maxXlsxUncompressedBytes: 50 * 1024 * 1024,
  maxXlsxEntryBytes: 25 * 1024 * 1024,
  maxXlsxCompressionRatio: 200,
  stagingChunkSize: 500,
});

export function resolveImportLimits(overrides: Partial<ImportLimits> = {}): ImportLimits {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...overrides };

  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`Limite de importação inválido: ${name}`);
    }
  }

  return limits;
}
