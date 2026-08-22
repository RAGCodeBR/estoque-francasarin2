import type {
  ColumnMapping,
  ImportFile,
  ImportLimits,
  ImportParserOptions,
  ImportTargetField,
  ImportValueMappings,
  TabularFormat,
} from './types';

export type LegacyScalarType = 'BOOLEAN' | 'DATE' | 'DECIMAL' | 'INTEGER' | 'TEXT';
export type AnalysisSeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface LegacySourceConfiguration {
  headerRowNumber?: number;
  columnMapping?: readonly ColumnMapping[];
}

export interface AnalyzeLegacyMigrationFileInput {
  file: ImportFile;
  analyzedAt?: string;
  limits?: Partial<ImportLimits>;
  parserOptions?: ImportParserOptions;
  distinctValueSampleLimit?: number;
  sourceConfigurations?: Readonly<Record<string, LegacySourceConfiguration>>;
  valueMappings?: Partial<ImportValueMappings>;
}

export interface LegacyAnalysisFinding {
  severity: AnalysisSeverity;
  code: string;
  source: string;
  field?: string;
  rowNumber?: number;
  value?: string | null;
  problem: string;
  suggestedAction: string;
}

export interface LegacyValueFrequency {
  value: string;
  count: number;
}

export interface LegacyColumnProfile {
  name: string;
  position: number;
  nonEmptyValues: number;
  emptyValues: number;
  uniqueValues: number;
  distinctValuesSample: readonly LegacyValueFrequency[];
  inferredTypes: Readonly<Partial<Record<LegacyScalarType, number>>>;
  sampleValues: readonly string[];
  sampleTruncated: boolean;
}

export interface LegacyColumnMappingProposal {
  sourceColumn: string;
  targetField: ImportTargetField | 'IGNORE' | null;
  status: 'PROPOSED' | 'CONFIRMED' | 'REVIEW_REQUIRED';
  confidence: 'HIGH' | 'MEDIUM' | 'NONE';
  reason: string;
}

export interface LegacyTransformationProposal {
  field: ImportTargetField;
  original: string;
  destination: string | null;
  occurrences: number;
  status: 'PROPOSED' | 'REVIEW_REQUIRED';
  reason: string;
}

export interface LegacyDuplicateValue {
  value: string;
  normalizedValue: string;
  rowNumbers: readonly number[];
}

export interface LegacyDuplicateProductCandidate {
  reason: 'DUPLICATE_EAN' | 'NORMALIZED_NAME';
  value: string;
  rowNumbers: readonly number[];
}

export interface LegacyQuantityProblem {
  rowNumber: number;
  field: 'minimum_quantity' | 'opening_quantity';
  value: string;
  reason: 'INVALID' | 'NEGATIVE';
}

export interface LegacySourceSummary {
  totalProducts: number;
  uniqueSkus: number | null;
  duplicateSkus: readonly LegacyDuplicateValue[];
  eans: {
    informed: number;
    unique: number;
    valid: number;
    invalid: readonly { rowNumber: number; value: string }[];
  } | null;
  categories: readonly LegacyValueFrequency[] | null;
  productTypes: readonly LegacyValueFrequency[] | null;
  units: readonly LegacyValueFrequency[] | null;
  productsWithoutCategory: number | null;
  productsWithoutUnit: number | null;
  invalidQuantities: readonly LegacyQuantityProblem[] | null;
  negativeQuantities: readonly LegacyQuantityProblem[] | null;
  duplicateProductCandidates: readonly LegacyDuplicateProductCandidate[];
  unknownFields: readonly string[];
}

export interface LegacySourceAnalysis {
  name: string;
  position: number;
  status: 'ANALYZED' | 'EMPTY' | 'ERROR';
  headerRowNumber: number | null;
  rowCount: number;
  productTableCandidate: boolean;
  columns: readonly LegacyColumnProfile[];
  columnMapping: readonly LegacyColumnMappingProposal[];
  transformations: readonly LegacyTransformationProposal[];
  summary: LegacySourceSummary | null;
  findings: readonly LegacyAnalysisFinding[];
}

export interface LegacyMigrationAnalysis {
  reportSchemaVersion: 1;
  mode: 'READ_ONLY_LEGACY_ANALYSIS';
  analyzedAt: string;
  file: {
    originalFilename: string;
    sizeBytes: number;
    sha256: string;
    format: TabularFormat;
  };
  availableSources: readonly { name: string; position: number }[];
  sources: readonly LegacySourceAnalysis[];
  totals: {
    sources: number;
    analyzedSources: number;
    rows: number;
    productCandidateRows: number;
    findings: number;
    errors: number;
    warnings: number;
  };
  destructiveActionsExecuted: false;
  stagingExecuted: false;
  dryRunExecuted: false;
  confirmationPrepared: false;
}

export interface LegacyAnalysisCustodyManifest {
  manifestSchemaVersion: 1;
  kind: 'LEGACY_MIGRATION_EVIDENCE';
  createdAt: string;
  originalFilename: string;
  preservedFilename: string;
  sizeBytes: number;
  sha256: string;
  readOnly: true;
  analysisMode: 'READ_ONLY_LEGACY_ANALYSIS';
}
