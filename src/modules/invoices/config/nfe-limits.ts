export interface NfeXmlLimits {
  readonly maxFileBytes: number;
  readonly maxItems: number;
  readonly maxTextLength: number;
}

export const DEFAULT_NFE_XML_LIMITS: NfeXmlLimits = {
  maxFileBytes: 10 * 1024 * 1024,
  maxItems: 5_000,
  maxTextLength: 2_000,
};
