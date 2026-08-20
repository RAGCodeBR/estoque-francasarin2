export const IMPORT_TARGET_FIELDS = [
  'sku',
  'name',
  'ean',
  'external_id',
  'opening_quantity',
  'minimum_quantity',
  'unit',
  'category',
  'product_type',
] as const;

export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];
export type MappingTarget = ImportTargetField | 'IGNORE';
export type TabularFormat = 'CSV' | 'XLSX';

export interface ColumnMapping {
  sourceColumn: string;
  targetField: MappingTarget;
}

export interface ImportFile {
  readonly name: string;
  readonly size: number;
  readonly type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type RawImportData = Readonly<Record<string, string | null>>;

export interface ParsedImportRow {
  rowNumber: number;
  rawData: RawImportData;
}

export interface ParsedTable {
  format: TabularFormat;
  headers: readonly string[];
  rows: readonly ParsedImportRow[];
  metadata: Readonly<Record<string, string | number | readonly string[]>>;
}

export interface ImportLimits {
  maxFileSizeBytes: number;
  maxRows: number;
  maxColumns: number;
  maxCellLength: number;
  maxXlsxEntries: number;
  maxXlsxUncompressedBytes: number;
  maxXlsxEntryBytes: number;
  maxXlsxCompressionRatio: number;
  stagingChunkSize: number;
}

export interface CsvParserOptions {
  delimiter?: ',' | ';' | '\t' | '|';
  encoding?: 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be';
  headerRowNumber?: number;
}

export interface XlsxParserOptions {
  worksheetName?: string;
  headerRowNumber?: number;
}

export interface ImportParserOptions {
  csv?: CsvParserOptions;
  xlsx?: XlsxParserOptions;
}

export interface NormalizedImportData {
  sku: string | null;
  name: string | null;
  ean: string | null;
  external_id: string | null;
  opening_quantity: string | null;
  minimum_quantity: string | null;
  unit: 'UN' | 'KG' | null;
  category: string | null;
  product_type: 'RAW' | 'FRACTIONATED' | null;
}

export type ValidationState = 'VALID' | 'WARNING' | 'ERROR' | 'CONFLICT' | 'IGNORED';
export type ValidationSeverity = 'WARNING' | 'ERROR' | 'CONFLICT';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  rowNumber: number;
  field: ImportTargetField | 'row';
  value: string | null;
  problem: string;
  suggestedCorrection: string;
}

export type DryRunAction = 'NEW' | 'UPDATE_CANDIDATE' | 'CONFLICT' | 'IGNORED';

export interface CategoryCandidate {
  normalizedName: string;
  sourceValue: string;
  approvedForCreation: boolean;
}

export interface ProductSuggestion {
  productId: string;
  sku: string;
  name: string;
  reason: 'SIMILAR_NAME';
  confidence?: number;
}

export interface DryRunRow {
  rowNumber: number;
  rawData: RawImportData;
  normalizedData: NormalizedImportData;
  state: ValidationState;
  action: DryRunAction | null;
  issues: readonly ValidationIssue[];
  categoryCandidate?: CategoryCandidate;
  suggestions?: readonly ProductSuggestion[];
  resolvedEntityId?: string;
  matchedBy?: ProductMatchKind;
}

export interface DryRunSummary {
  TOTAL: number;
  VALID: number;
  INVALID: number;
  NEW: number;
  UPDATE_CANDIDATE: number;
  CONFLICT: number;
  IGNORED: number;
}

export interface DryRunResult {
  batchId: string;
  summary: DryRunSummary;
  rows: readonly DryRunRow[];
}

export interface ExistingProduct {
  id: string;
  sku: string;
  ean?: string | null;
  name: string;
  unit: 'UN' | 'KG';
  category: string;
  productType: 'RAW' | 'FRACTIONATED';
  minimumQuantity?: string;
}

export interface ExistingCategory {
  id: string;
  name: string;
}

export type ProductMatchKind = 'EXTERNAL_MAPPING' | 'SKU' | 'EAN' | 'OTHER';

export const PRODUCT_MATCH_PRIORITY: readonly ProductMatchKind[] = [
  'EXTERNAL_MAPPING',
  'SKU',
  'EAN',
  'OTHER',
];

export interface ProductIdentityQuery {
  rowNumber: number;
  sourceSystem: string;
  externalId: string | null;
  sku: string;
  ean: string | null;
}

export interface ProductIdentityMatch {
  rowNumber: number;
  matchedBy: ProductMatchKind;
  product: ExistingProduct;
}

export interface ProductNameQuery {
  rowNumber: number;
  name: string;
}

export interface ProductNameSuggestion {
  rowNumber: number;
  product: ExistingProduct;
  confidence?: number;
}

export interface ValueMapping<TTarget extends string> {
  sourceValue: string;
  targetValue: TTarget;
}

export interface ImportValueMappings {
  unit: readonly ValueMapping<'UN' | 'KG'>[];
  productType: readonly ValueMapping<'RAW' | 'FRACTIONATED'>[];
}

export type ConflictResolution =
  | { rowNumber: number; decision: 'IGNORE' }
  | { rowNumber: number; decision: 'REPLACE_SKU'; replacementSku: string }
  | { rowNumber: number; decision: 'USE_EXISTING'; productId: string };
