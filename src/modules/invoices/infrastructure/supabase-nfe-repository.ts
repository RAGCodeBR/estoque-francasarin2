import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSupabaseClient,
  isRecord,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import type { NfeConfirmationReport } from '../domain/types';
import type { NfeRepository, StageNfeInput } from '../ports/nfe-repository';

function integer(value: Readonly<Record<string, unknown>>, key: string): number {
  const result = value[key];
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0)
    throw new Error(`Campo numérico inválido: ${key}.`);
  return result;
}

export class SupabaseNfeRepository implements NfeRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async stage(input: StageNfeInput): Promise<string> {
    const invoice = input.invoice;
    const data = await unwrapSupabaseResponse(
      this.client.rpc('stage_nfe_xml', {
        p_file_hash: input.fileHash,
        p_original_filename: input.originalFilename,
        p_original_file_path: input.originalFilePath ?? null,
        p_access_key: invoice.accessKey,
        p_invoice_number: invoice.invoiceNumber,
        p_series: invoice.series,
        p_issued_at: invoice.issuedAt,
        p_supplier_document: invoice.supplier.document,
        p_supplier_legal_name: invoice.supplier.legalName,
        p_supplier_trade_name: invoice.supplier.tradeName,
        p_items: invoice.items,
      }),
    );
    if (typeof data !== 'string') throw new Error('ID inválido ao criar staging da NF-e.');
    return data;
  }

  async review(
    importId: string,
    supplierId: string,
    items: Parameters<NfeRepository['review']>[2],
  ): Promise<'PENDING_REVIEW' | 'READY'> {
    const data = await unwrapSupabaseResponse(
      this.client.rpc('review_nfe_import', {
        p_invoice_import_id: importId,
        p_supplier_id: supplierId,
        p_item_resolutions: items,
      }),
    );
    if (data !== 'PENDING_REVIEW' && data !== 'READY')
      throw new Error('Status inválido após revisão da NF-e.');
    return data;
  }

  async confirm(
    importId: string,
    destinationLocationId: string,
    idempotencyKey: string,
  ): Promise<NfeConfirmationReport> {
    const data = await unwrapSupabaseResponse(
      this.client.rpc('confirm_nfe_import', {
        p_invoice_import_id: importId,
        p_destination_location_id: destinationLocationId,
        p_idempotency_key: idempotencyKey,
      }),
    );
    if (!isRecord(data)) throw new Error('Relatório inválido após confirmação da NF-e.');
    return {
      invoiceId: requiredString(data, 'invoiceId'),
      itemsCreated: integer(data, 'itemsCreated'),
      movementsCreated: integer(data, 'movementsCreated'),
      supplierMappingsCreated: integer(data, 'supplierMappingsCreated'),
      applied: requiredBoolean(data, 'applied'),
    };
  }
}
