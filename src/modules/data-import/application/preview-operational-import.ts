import { resolveImportLimits } from '../config/import-limits';
import {
  applyOperationalColumnMapping,
  validateOperationalColumnMapping,
} from '../domain/operational-mapping';
import { normalizeOperationalRow } from '../domain/operational-normalization';
import type {
  OperationalPreviewPage,
  PreviewOperationalImportInput,
} from '../domain/operational-types';
import { loadAndParseImportFile } from '../parsers/parse-tabular-file';

export async function previewOperationalImport(
  input: PreviewOperationalImportInput,
): Promise<OperationalPreviewPage> {
  const sourceName = input.sourceName.normalize('NFKC').trim();
  if (!sourceName) throw new TypeError('A origem da importação é obrigatória.');

  const limits = resolveImportLimits(input.limits);
  const loaded = await loadAndParseImportFile(input.file, input.parserOptions, limits);
  validateOperationalColumnMapping(input.importType, loaded.parsed.headers, input.mapping);

  const rows = loaded.parsed.rows.map((row) => {
    const mapped = applyOperationalColumnMapping(row.rawData, input.mapping);
    const normalized = normalizeOperationalRow(
      input.importType,
      mapped,
      row.rowNumber,
      input.valueMappings,
    );
    return {
      rowNumber: row.rowNumber,
      rawData: row.rawData,
      normalizedData: normalized.data,
      validationErrors: normalized.issues,
      ignored: normalized.ignored,
    };
  });

  const staged = await input.repository.stagePreview({
    importType: input.importType,
    sourceType: loaded.parsed.format,
    sourceName,
    originalFilename: input.file.name,
    fileHash: loaded.fileHash,
    fileSizeBytes: input.file.size,
    detectedHeaders: loaded.parsed.headers,
    columnMapping: input.mapping,
    rows,
    ...(input.allowDuplicateOfBatchId ? { duplicateOfBatchId: input.allowDuplicateOfBatchId } : {}),
  });

  return input.repository.getPreview(staged.batchId, 1, input.pageSize ?? 100);
}
