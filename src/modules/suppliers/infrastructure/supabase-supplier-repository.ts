import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSupabaseClient,
  isRecord,
  nullableString,
  parsePagePayload,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import { createPaginatedResult } from '../../../types/pagination';
import type {
  Supplier,
  SupplierPage,
  SupplierRecord,
  SupplierSearch,
  SupplierUpdateRecord,
} from '../domain/types';
import type { SupplierRepository } from '../ports/supplier-repository';

function parseSupplier(value: unknown): Supplier {
  if (!isRecord(value)) throw new Error('Fornecedor inválido na resposta do banco.');
  return {
    id: requiredString(value, 'id'),
    legalName: requiredString(value, 'legal_name'),
    tradeName: nullableString(value, 'trade_name'),
    document: nullableString(value, 'document'),
    isActive: requiredBoolean(value, 'is_active'),
    createdAt: requiredString(value, 'created_at'),
    updatedAt: requiredString(value, 'updated_at'),
  };
}

function databaseRecord(record: SupplierRecord | SupplierUpdateRecord) {
  return {
    ...(record.legalName === undefined ? {} : { legal_name: record.legalName }),
    ...(record.tradeName === undefined ? {} : { trade_name: record.tradeName }),
    ...(record.document === undefined ? {} : { document: record.document }),
    ...('isActive' in record ? { is_active: record.isActive } : {}),
  };
}

export class SupabaseSupplierRepository implements SupplierRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async create(record: SupplierRecord): Promise<Supplier> {
    const data = await unwrapSupabaseResponse(
      this.client.from('suppliers').insert(databaseRecord(record)).select('*').single(),
    );
    return parseSupplier(data);
  }

  async getById(id: string): Promise<Supplier | null> {
    const data = await unwrapSupabaseResponse(
      this.client.rpc('get_supplier', { p_supplier_id: id }),
    );
    return data === null ? null : parseSupplier(data);
  }

  async search(query: SupplierSearch): Promise<SupplierPage> {
    const payload = parsePagePayload(
      await unwrapSupabaseResponse(
        this.client.rpc('search_suppliers', {
          p_search: query.search ?? null,
          p_is_active: query.isActive ?? null,
          p_page: query.page,
          p_page_size: query.pageSize,
        }),
      ),
    );
    return createPaginatedResult(
      payload.items.map(parseSupplier),
      payload.total,
      payload.page,
      payload.pageSize,
    );
  }

  async update(id: string, record: SupplierUpdateRecord): Promise<Supplier> {
    const data = await unwrapSupabaseResponse(
      this.client
        .from('suppliers')
        .update(databaseRecord(record))
        .eq('id', id)
        .select('*')
        .single(),
    );
    return parseSupplier(data);
  }
}
