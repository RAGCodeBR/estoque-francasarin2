import type { SupabaseClient } from '@supabase/supabase-js';

import { getAuthenticatedUserId, getSupabaseClient } from '../../../lib/supabase';
import { calculateSha256 } from '../../data-import/infrastructure/file-hash';
import type { NfeXmlFile } from '../domain/types';
import type { NfeXmlStorage } from '../ports/nfe-xml-storage';

export class SupabaseNfeXmlStorage implements NfeXmlStorage {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async store(file: NfeXmlFile, fileHash: string): Promise<string> {
    const actorId = await getAuthenticatedUserId(this.client);
    const path = `${actorId}/${fileHash}.xml`;
    const { error } = await this.client.storage
      .from('invoice-xml')
      .upload(path, new Uint8Array(await file.arrayBuffer()), {
        contentType: 'application/xml',
        upsert: false,
      });
    if (error && !/already exists|duplicate/i.test(error.message)) throw error;
    if (error) {
      const existing = await this.client.storage.from('invoice-xml').download(path);
      if (existing.error) throw existing.error;
      const existingHash = await calculateSha256(new Uint8Array(await existing.data.arrayBuffer()));
      if (existingHash !== fileHash) {
        throw new Error('O caminho idempotente do XML já contém conteúdo com hash diferente.');
      }
    }
    return path;
  }
}
