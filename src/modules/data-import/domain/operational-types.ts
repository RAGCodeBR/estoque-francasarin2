import type {
  ImportFile,
  ImportLimits,
  ImportParserOptions,
  ImportValueMappings,
  RawImportData,
  ValidationIssue,
  ValidationState,
} from './types';

export const OPERATIONAL_IMPORT_TYPES = [
  'PRODUCTS',
  'CATEGORIES',
  'LOCATIONS',
  'SUPPLIERS',
  'STOCK_RECONCILIATION',
] as const;

export type OperationalImportType = (typeof OPERATIONAL_IMPORT_TYPES)[number];
export type OperationalTemplateFormat = 'CSV' | 'XLSX';

export const OPERATIONAL_TARGET_FIELDS = [
  'sku',
  'ean',
  'name',
  'category',
  'product_type',
  'unit',
  'minimum_quantity',
  'description',
  'location_type',
  'document',
  'legal_name',
  'trade_name',
  'current_quantity',
] as const;

export type OperationalTargetField = (typeof OPERATIONAL_TARGET_FIELDS)[number];
export type OperationalMappingTarget = OperationalTargetField | 'IGNORE';

export interface OperationalColumnMapping {
  sourceColumn: string;
  targetField: OperationalMappingTarget;
}

export type OperationalNormalizedData = Readonly<
  Partial<Record<OperationalTargetField, string | null>>
>;

export interface OperationalPreviewSummary {
  TOTAL: number;
  VALID: number;
  INVALID: number;
  NEW: number;
  UPDATE_CANDIDATE: number;
  CONFLICT: number;
  IGNORED: number;
  POSITIVE: number;
  NEGATIVE: number;
  UNCHANGED: number;
}

export interface StockReconciliationComparison {
  productId: string;
  sku: string;
  productName: string;
  systemQuantity: string;
  fileQuantity: string;
  difference: string;
  movementType: 'ADJUSTMENT_POSITIVE' | 'ADJUSTMENT_NEGATIVE' | null;
}

export interface OperationalPreviewRow {
  rowNumber: number;
  rawData: RawImportData;
  normalizedData: OperationalNormalizedData | null;
  state: ValidationState | null;
  action: 'NEW' | 'UPDATE_CANDIDATE' | 'CONFLICT' | 'IGNORED' | null;
  issues: readonly ValidationIssue[];
  resolvedEntityId?: string;
  comparison?: StockReconciliationComparison;
}

export interface OperationalPreviewPage {
  batchId: string;
  importType: OperationalImportType;
  status: string;
  summary: OperationalPreviewSummary;
  rows: readonly OperationalPreviewRow[];
  page: number;
  pageSize: number;
  totalRows: number;
}

export interface PreviewOperationalImportInput {
  file: ImportFile;
  importType: OperationalImportType;
  sourceName: string;
  mapping: readonly OperationalColumnMapping[];
  repository: OperationalImportRepository;
  parserOptions?: ImportParserOptions;
  limits?: Partial<ImportLimits>;
  valueMappings?: Partial<ImportValueMappings>;
  allowDuplicateOfBatchId?: string;
  pageSize?: number;
}

export type OperationalConflictResolution =
  | { rowNumber: number; decision: 'IGNORE' }
  | { rowNumber: number; decision: 'USE_EXISTING'; entityId: string };

export interface OperationalConfirmationOptions {
  batchId: string;
  importType: OperationalImportType;
  idempotencyKey: string;
  updateExisting?: boolean;
  stockLocationId?: string;
  reason?: string;
}

export interface OperationalConfirmationReport {
  batchId: string;
  importType: OperationalImportType;
  applied: boolean;
  created: number;
  associated: number;
  updated: number;
  movementsCreated: number;
  unchanged: number;
  ignored: number;
  warnings: number;
  errors: number;
}

export interface StageOperationalPreviewInput {
  importType: OperationalImportType;
  sourceType: 'CSV' | 'XLSX';
  sourceName: string;
  originalFilename: string;
  fileHash: string;
  fileSizeBytes: number;
  detectedHeaders: readonly string[];
  columnMapping: readonly OperationalColumnMapping[];
  rows: readonly {
    rowNumber: number;
    rawData: RawImportData;
    normalizedData: OperationalNormalizedData | null;
    validationErrors: readonly ValidationIssue[];
    ignored: boolean;
  }[];
  duplicateOfBatchId?: string;
}

export interface OperationalImportRepository {
  stagePreview(input: StageOperationalPreviewInput): Promise<{
    batchId: string;
    status: string;
    summary: OperationalPreviewSummary;
  }>;
  getPreview(batchId: string, page: number, pageSize: number): Promise<OperationalPreviewPage>;
  resolve(
    batchId: string,
    resolutions: readonly OperationalConflictResolution[],
    approvedCategories: readonly string[],
  ): Promise<OperationalPreviewSummary>;
  confirm(options: OperationalConfirmationOptions): Promise<OperationalConfirmationReport>;
}

export interface OperationalImportTemplate {
  importType: OperationalImportType;
  format: OperationalTemplateFormat;
  filename: string;
  mimeType: string;
  worksheetName?: string;
  bytes: Uint8Array;
}
