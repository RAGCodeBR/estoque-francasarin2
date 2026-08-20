import type { SupabaseClient } from '@supabase/supabase-js';

import { getAuthenticatedUserId, getSupabaseClient } from '../../../lib/supabase';
import { calculateSha256 } from '../../data-import/infrastructure/file-hash';
import type { PdfInvoiceFile } from '../domain/pdf-types';
import type { PdfInvoiceStorage } from '../ports/pdf-invoice-storage';

export class SupabasePdfInvoiceStorage implements PdfInvoiceStorage {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async store(file: PdfInvoiceFile, fileHash: string): Promise<string> {
    const actorId = await getAuthenticatedUserId(this.client);
    const path = `${actorId}/${fileHash}.pdf`;
    const { error } = await this.client.storage
      .from('invoice-pdf')
      .upload(path, new Uint8Array(await file.arrayBuffer()), {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (error && !/already exists|duplicate/i.test(error.message)) throw error;
    if (error) {
      const existing = await this.client.storage.from('invoice-pdf').download(path);
      if (existing.error) throw existing.error;
      if ((await calculateSha256(new Uint8Array(await existing.data.arrayBuffer()))) !== fileHash) {
        throw new Error('O caminho idempotente do PDF já contém conteúdo com hash diferente.');
      }
    }
    return path;
  }
}
