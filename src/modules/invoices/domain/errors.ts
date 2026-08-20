export class NfeXmlError extends Error {
  constructor(
    readonly code:
      | 'FILE_TOO_LARGE'
      | 'INVALID_ENCODING'
      | 'UNSAFE_XML'
      | 'INVALID_XML'
      | 'UNSUPPORTED_DOCUMENT'
      | 'INVALID_NFE',
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'NfeXmlError';
  }
}
