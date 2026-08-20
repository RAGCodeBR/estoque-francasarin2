export { assertImportConfirmable } from './application/assert-import-confirmable';
export { confirmProductImport } from './application/confirm-product-import';
export { stageImportFile } from './application/stage-import-file';
export { runImportDryRun } from './application/run-import-dry-run';
export { DEFAULT_IMPORT_LIMITS, resolveImportLimits } from './config/import-limits';
export { ImportFileError } from './domain/errors';
export { SupabaseImportConfirmationRepository } from './infrastructure/supabase-import-confirmation-repository';
export { isValidEan } from './domain/normalization';
export { DEFAULT_VALUE_MAPPINGS } from './domain/value-mapping';
export { PRODUCT_MATCH_PRIORITY } from './domain/types';
export { validateColumnMapping } from './domain/column-mapping';
export type {
  ColumnMapping,
  ConfirmProductImportOptions,
  ConflictResolution,
  DryRunResult,
  DryRunSummary,
  ExistingProductImportStrategy,
  ImportFile,
  ImportLimits,
  ImportParserOptions,
  ImportValueMappings,
  MasterQuantityImportStrategy,
  ProductImportMode,
  ProductImportReport,
  ValidationIssue,
  ValidationState,
  ValueMapping,
} from './domain/types';
export type { CategoryLookup } from './ports/category-lookup';
export type { ProductLookup } from './ports/product-lookup';
export type { ImportStagingRepository } from './ports/staging-repository';
export type { ImportConfirmationRepository } from './ports/import-confirmation-repository';
