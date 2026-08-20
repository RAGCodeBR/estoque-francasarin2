import type { NfeConfirmationReport } from '../domain/types';
import type {
  ParsedPdfInvoiceFile,
  PdfHeaderReview,
  PdfInvoiceImportPreview,
  PdfItemReview,
} from '../domain/pdf-types';

export interface StagePdfInvoiceInput extends ParsedPdfInvoiceFile {
  readonly originalFilePath?: string | null;
}

export interface PdfInvoiceRepository {
  stage(input: StagePdfInvoiceInput): Promise<string>;
  getPreview(importId: string): Promise<PdfInvoiceImportPreview>;
  review(
    importId: string,
    header: PdfHeaderReview,
    items: readonly PdfItemReview[],
  ): Promise<'PENDING_REVIEW' | 'READY'>;
  confirm(
    importId: string,
    destinationLocationId: string,
    idempotencyKey: string,
  ): Promise<NfeConfirmationReport>;
}
