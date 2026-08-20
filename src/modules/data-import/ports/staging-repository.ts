import type {
  ColumnMapping,
  DryRunRow,
  DryRunSummary,
  ImportValueMappings,
  ParsedImportRow,
  TabularFormat,
} from '../domain/types';

export interface DuplicateImportBatch {
  id: string;
  status: string;
}

export interface CreateStagedBatchInput {
  sourceType: TabularFormat;
  sourceName: string;
  originalFilename: string;
  fileHash: string;
  fileSizeBytes: number;
  createdBy: string;
  detectedHeaders: readonly string[];
  parserMetadata: Readonly<Record<string, unknown>>;
  duplicateOfBatchId?: string;
}

export interface StagedBatchData {
  id: string;
  sourceName: string;
  headers: readonly string[];
  rows: readonly ParsedImportRow[];
}

export interface SaveDryRunInput {
  mapping: readonly ColumnMapping[];
  valueMapping: Partial<ImportValueMappings>;
  valueMappingVersion: number;
  approvedCategoryCreations: readonly string[];
  summary: DryRunSummary;
  rows: readonly DryRunRow[];
}

/**
 * Implementações devem garantir atomicidade em createBatchWithRows e saveDryRun.
 * Este contrato não oferece nenhuma operação sobre products ou stock_balances.
 */
export interface ImportStagingRepository {
  findOriginalByFileHash(fileHash: string): Promise<DuplicateImportBatch | null>;
  createBatchWithRows(
    input: CreateStagedBatchInput,
    rows: readonly ParsedImportRow[],
    chunkSize: number,
  ): Promise<string>;
  loadBatch(batchId: string): Promise<StagedBatchData>;
  saveDryRun(batchId: string, input: SaveDryRunInput): Promise<void>;
}
