export interface PdfImportLimits {
  readonly maxFileBytes: number;
  readonly maxPages: number;
  readonly maxExtractedCharacters: number;
  readonly maxItems: number;
}

export const DEFAULT_PDF_IMPORT_LIMITS: PdfImportLimits = {
  maxFileBytes: 15 * 1024 * 1024,
  maxPages: 100,
  maxExtractedCharacters: 2_000_000,
  maxItems: 5_000,
};
