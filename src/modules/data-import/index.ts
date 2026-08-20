export { assertImportConfirmable } from './application/assert-import-confirmable';
export { stageImportFile } from './application/stage-import-file';
export { runImportDryRun } from './application/run-import-dry-run';
export { DEFAULT_IMPORT_LIMITS, resolveImportLimits } from './config/import-limits';
export { ImportFileError } from './domain/errors';
export { isValidEan } from './domain/normalization';
export { DEFAULT_VALUE_MAPPINGS } from './domain/value-mapping';
export { PRODUCT_MATCH_PRIORITY } from './domain/types';
export { validateColumnMapping } from './domain/column-mapping';
export type {
  ColumnMapping,
  ConflictResolution,
  DryRunResult,
  DryRunSummary,
  ImportValueMappings,
  ImportFile,
  ImportLimits,
  ImportParserOptions,
  ValidationIssue,
  ValidationState,
  ValueMapping,
} from './domain/types';
export type { CategoryLookup } from './ports/category-lookup';
export type { ProductLookup } from './ports/product-lookup';
export type { ImportStagingRepository } from './ports/staging-repository';
