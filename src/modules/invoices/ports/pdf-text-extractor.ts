import type { PdfImportLimits } from '../config/pdf-limits';
import type { PdfTextExtraction } from '../domain/pdf-types';

export interface PdfTextExtractor {
  extract(bytes: Uint8Array, limits: PdfImportLimits): Promise<PdfTextExtraction>;
}
