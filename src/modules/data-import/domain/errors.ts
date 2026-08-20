export type ImportErrorCode =
  | 'DUPLICATE_COLUMN'
  | 'DUPLICATE_FILE'
  | 'EMPTY_FILE'
  | 'EMPTY_HEADER'
  | 'FILE_TOO_LARGE'
  | 'FORMULA_NOT_ALLOWED'
  | 'IMPORT_NOT_CONFIRMABLE'
  | 'INVALID_COLUMN_MAPPING'
  | 'INVALID_CSV'
  | 'INVALID_ENCODING'
  | 'INVALID_FILE_TYPE'
  | 'INVALID_VALUE_MAPPING'
  | 'INVALID_XLSX'
  | 'LIMIT_EXCEEDED'
  | 'MULTIPLE_WORKSHEETS'
  | 'UNSAFE_XLSX_CONTAINER'
  | 'WORKSHEET_NOT_FOUND';

export class ImportFileError extends Error {
  readonly code: ImportErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ImportErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ImportFileError';
    this.code = code;
    this.details = details;
  }
}
