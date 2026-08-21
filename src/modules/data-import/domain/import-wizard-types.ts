import type {
  ColumnMapping,
  ImportFile,
  ImportLimits,
  ImportParserOptions,
  ImportValueMappings,
  NormalizedImportData,
  ParsedImportRow,
  ProductImportMode,
  ProductImportReport,
  RawImportData,
  TabularFormat,
  ValidationIssue,
  ValidationState,
} from './types';

export interface ImportFileInspection {
  file: ImportFile;
  fileHash: string;
  format: TabularFormat;
  headers: readonly string[];
  rows: readonly ParsedImportRow[];
  sampleRows: readonly ParsedImportRow[];
  distinctValues: Readonly<Record<string, readonly string[]>>;
  metadata: Readonly<Record<string, string | number | readonly string[]>>;
}

export interface InspectProductImportFileInput {
  file: ImportFile;
  parserOptions?: ImportParserOptions;
  limits?: Partial<ImportLimits>;
  sampleSize?: number;
  distinctValueLimit?: number;
}

export interface PreparedProductImportRow {
  rowNumber: number;
  rawData: RawImportData;
  normalizedData: NormalizedImportData;
  validationErrors: readonly ValidationIssue[];
  ignored: boolean;
}

export interface LocalValidationSummary {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  conflicts: number;
  ignored: number;
}

export interface PreparedProductImport {
  rows: readonly PreparedProductImportRow[];
  summary: LocalValidationSummary;
}

export interface PrepareProductImportInput {
  mode: ProductImportMode;
  inspection: ImportFileInspection;
  mapping: readonly ColumnMapping[];
  valueMappings?: Partial<ImportValueMappings>;
}

export interface ProductImportPreviewSummary {
  TOTAL: number;
  VALID: number;
  INVALID: number;
  NEW: number;
  UPDATE_CANDIDATE: number;
  CONFLICT: number;
  IGNORED: number;
  WARNING: number;
  CATEGORIES_NEW: number;
}

export interface ProductImportPreviewRow {
  rowNumber: number;
  rawData: RawImportData;
  normalizedData: NormalizedImportData | null;
  state: ValidationState | null;
  action: 'NEW' | 'UPDATE_CANDIDATE' | 'CONFLICT' | 'IGNORED' | null;
  issues: readonly ValidationIssue[];
  resolvedEntityId?: string;
  categoryCandidate?: {
    normalizedName: string;
    sourceValue: string;
    approvedForCreation: boolean;
  };
  suggestions?: readonly {
    productId: string;
    sku: string;
    name: string;
    reason: 'SIMILAR_NAME';
  }[];
}

export interface ProductImportPreviewPage {
  batchId: string;
  mode: ProductImportMode;
  status: string;
  summary: ProductImportPreviewSummary;
  rows: readonly ProductImportPreviewRow[];
  page: number;
  pageSize: number;
  totalRows: number;
}

export interface StageProductImportPreviewInput {
  mode: ProductImportMode;
  sourceType: TabularFormat;
  sourceName: string;
  originalFilename: string;
  fileHash: string;
  fileSizeBytes: number;
  detectedHeaders: readonly string[];
  columnMapping: readonly ColumnMapping[];
  valueMappings: Partial<ImportValueMappings>;
  rows: readonly PreparedProductImportRow[];
  duplicateOfBatchId?: string;
}

export type ProductImportConflictResolution =
  | { rowNumber: number; decision: 'IGNORE' }
  | { rowNumber: number; decision: 'USE_EXISTING'; entityId: string };

export interface ProductImportWizardRepository {
  stagePreview(input: StageProductImportPreviewInput): Promise<{ batchId: string }>;
  getPreview(batchId: string, page: number, pageSize: number): Promise<ProductImportPreviewPage>;
  resolve(
    batchId: string,
    resolutions: readonly ProductImportConflictResolution[],
    approvedCategories: readonly string[],
  ): Promise<ProductImportPreviewSummary>;
}

export interface ImportResultDetails {
  report: ProductImportReport;
  startedAt: string;
  finishedAt: string;
  elapsedMilliseconds: number;
  filename: string;
  sourceName: string;
}
