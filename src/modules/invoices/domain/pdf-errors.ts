export class PdfImportError extends Error {
  constructor(
    readonly code:
      | 'FILE_TOO_LARGE'
      | 'UNSUPPORTED_DOCUMENT'
      | 'INVALID_PDF'
      | 'PASSWORD_PROTECTED'
      | 'PAGE_LIMIT_EXCEEDED'
      | 'TEXT_LIMIT_EXCEEDED',
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'PdfImportError';
  }
}
