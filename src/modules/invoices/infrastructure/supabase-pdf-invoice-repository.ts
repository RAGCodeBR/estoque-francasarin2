import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSupabaseClient,
  isRecord,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import type { NfeConfirmationReport } from '../domain/types';
import type { PdfInvoiceImportPreview } from '../domain/pdf-types';
import type { PdfInvoiceRepository, StagePdfInvoiceInput } from '../ports/pdf-invoice-repository';

function integer(value: Readonly<Record<string, unknown>>, key: string): number {
  const result = value[key];
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0)
    throw new Error(`Campo numérico inválido: ${key}.`);
  return result;
}

function confirmation(value: unknown): NfeConfirmationReport {
  if (!isRecord(value)) throw new Error('Relatório inválido após confirmação do PDF.');
  return {
    invoiceId: requiredString(value, 'invoiceId'),
    itemsCreated: integer(value, 'itemsCreated'),
    movementsCreated: integer(value, 'movementsCreated'),
    supplierMappingsCreated: integer(value, 'supplierMappingsCreated'),
    applied: requiredBoolean(value, 'applied'),
  };
}

export class SupabasePdfInvoiceRepository implements PdfInvoiceRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async stage(input: StagePdfInvoiceInput): Promise<string> {
    const invoice = input.invoice;
    const data = await unwrapSupabaseResponse(
      this.client.rpc('stage_pdf_invoice', {
        p_file_hash: input.fileHash,
        p_original_filename: input.originalFilename,
        p_original_file_path: input.originalFilePath ?? null,
        p_header: {
          accessKey: invoice.accessKey,
          invoiceNumber: invoice.invoiceNumber,
          series: invoice.series,
          issuedAt: invoice.issuedAt,
          supplierDocument: invoice.supplierDocument,
          supplierLegalName: invoice.supplierLegalName,
          issues: invoice.issues,
        },
        p_items: invoice.items,
        p_extraction_metadata: {
          pageCount: invoice.extraction.pageCount,
          characterCount: invoice.extraction.characterCount,
          parser: 'pdfjs-assisted-v1',
        },
        p_raw_extraction: { lines: invoice.extraction.lines },
      }),
    );
    if (typeof data !== 'string') throw new Error('ID inválido ao criar staging do PDF.');
    return data;
  }

  async getPreview(importId: string): Promise<PdfInvoiceImportPreview> {
    const data = await unwrapSupabaseResponse(
      this.client.rpc('get_invoice_import_preview', { p_invoice_import_id: importId }),
    );
    if (!isRecord(data) || !isRecord(data.import) || !Array.isArray(data.items))
      throw new Error('Preview de PDF inválido.');
    const items = data.items.filter(isRecord);
    if (items.length !== data.items.length) throw new Error('Itens inválidos no preview de PDF.');
    return { import: data.import, items };
  }

  async review(
    importId: string,
    header: Parameters<PdfInvoiceRepository['review']>[1],
    items: Parameters<PdfInvoiceRepository['review']>[2],
  ): Promise<'PENDING_REVIEW' | 'READY'> {
    const data = await unwrapSupabaseResponse(
      this.client.rpc('review_pdf_invoice', {
        p_invoice_import_id: importId,
        p_header: header,
        p_item_reviews: items,
      }),
    );
    if (data !== 'PENDING_REVIEW' && data !== 'READY')
      throw new Error('Status inválido após revisão do PDF.');
    return data;
  }

  async confirm(
    importId: string,
    destinationLocationId: string,
    idempotencyKey: string,
  ): Promise<NfeConfirmationReport> {
    return confirmation(
      await unwrapSupabaseResponse(
        this.client.rpc('confirm_pdf_invoice', {
          p_invoice_import_id: importId,
          p_destination_location_id: destinationLocationId,
          p_idempotency_key: idempotencyKey,
        }),
      ),
    );
  }
}
