import { resolveImportLimits } from '../config/import-limits';
import { ImportFileError } from '../domain/errors';
import type { ImportFile, ImportLimits, ImportParserOptions } from '../domain/types';
import { loadAndParseImportFile } from '../parsers/parse-tabular-file';
import type { ImportStagingRepository } from '../ports/staging-repository';

export interface StageImportFileInput {
  file: ImportFile;
  sourceName: string;
  createdBy: string;
  repository: ImportStagingRepository;
  parserOptions?: ImportParserOptions;
  limits?: Partial<ImportLimits>;
  allowDuplicateOfBatchId?: string;
}

export interface StageImportFileResult {
  batchId: string;
  fileHash: string;
  format: 'CSV' | 'XLSX';
  headers: readonly string[];
  totalRows: number;
}

export async function stageImportFile(input: StageImportFileInput): Promise<StageImportFileResult> {
  const sourceName = input.sourceName.normalize('NFKC').trim();
  if (sourceName === '') {
    throw new TypeError('A origem da importação é obrigatória.');
  }

  const limits = resolveImportLimits(input.limits);
  const loaded = await loadAndParseImportFile(input.file, input.parserOptions, limits);
  const duplicate = await input.repository.findOriginalByFileHash(loaded.fileHash);

  if (duplicate && input.allowDuplicateOfBatchId !== duplicate.id) {
    throw new ImportFileError(
      'DUPLICATE_FILE',
      'Este arquivo já possui um lote de importação. Confirme explicitamente para reprocessá-lo.',
      { existingBatchId: duplicate.id, existingStatus: duplicate.status },
    );
  }

  if (!duplicate && input.allowDuplicateOfBatchId) {
    throw new ImportFileError(
      'DUPLICATE_FILE',
      'O lote indicado não corresponde a um arquivo duplicado conhecido.',
    );
  }

  const duplicateFields = duplicate ? { duplicateOfBatchId: duplicate.id } : {};
  const batchId = await input.repository.createBatchWithRows(
    {
      sourceType: loaded.parsed.format,
      sourceName,
      originalFilename: input.file.name,
      fileHash: loaded.fileHash,
      fileSizeBytes: input.file.size,
      createdBy: input.createdBy,
      detectedHeaders: loaded.parsed.headers,
      parserMetadata: loaded.parsed.metadata,
      ...duplicateFields,
    },
    loaded.parsed.rows,
    limits.stagingChunkSize,
  );

  return {
    batchId,
    fileHash: loaded.fileHash,
    format: loaded.parsed.format,
    headers: loaded.parsed.headers,
    totalRows: loaded.parsed.rows.length,
  };
}
