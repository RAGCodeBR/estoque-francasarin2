import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getAuthenticatedUserId,
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
  Category,
  CategoryCreateRecord,
  CategoryPage,
  CategorySearch,
  CategoryUpdateRecord,
} from '../domain/types';
import type { CategoryRepository } from '../ports/category-repository';

const CATEGORY_COLUMNS = 'id,name,description,is_active,created_at,updated_at';

function parseCategory(value: unknown): Category {
  if (!isRecord(value)) throw new Error('Categoria inválida na resposta do banco.');
  return {
    id: requiredString(value, 'id'),
    name: requiredString(value, 'name'),
    description: nullableString(value, 'description'),
    isActive: requiredBoolean(value, 'is_active'),
    createdAt: requiredString(value, 'created_at'),
    updatedAt: requiredString(value, 'updated_at'),
  };
}

function toDatabaseRecord(record: CategoryCreateRecord | CategoryUpdateRecord) {
  return {
    ...(record.name === undefined ? {} : { name: record.name }),
    ...(record.description !== undefined ? { description: record.description } : {}),
    ...('isActive' in record ? { is_active: record.isActive } : {}),
  };
}

export class SupabaseCategoryRepository implements CategoryRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async create(record: CategoryCreateRecord): Promise<Category> {
    const actorId = await getAuthenticatedUserId(this.client);
    const data = await unwrapSupabaseResponse(
      this.client
        .from('categories')
        .insert({ ...toDatabaseRecord(record), created_by: actorId, updated_by: actorId })
        .select(CATEGORY_COLUMNS)
        .single(),
    );
    return parseCategory(data);
  }

  async getById(id: string): Promise<Category | null> {
    const data = await unwrapSupabaseResponse(
      this.client.from('categories').select(CATEGORY_COLUMNS).eq('id', id).maybeSingle(),
    );
    return data === null ? null : parseCategory(data);
  }

  async search(query: CategorySearch): Promise<CategoryPage> {
    const payload = parsePagePayload(
      await unwrapSupabaseResponse(
        this.client.rpc('search_categories', {
          p_search: query.search ?? null,
          p_is_active: query.isActive ?? null,
          p_page: query.page,
          p_page_size: query.pageSize,
        }),
      ),
    );
    return createPaginatedResult(
      payload.items.map(parseCategory),
      payload.total,
      payload.page,
      payload.pageSize,
    );
  }

  async update(id: string, record: CategoryUpdateRecord): Promise<Category> {
    const actorId = await getAuthenticatedUserId(this.client);
    const data = await unwrapSupabaseResponse(
      this.client
        .from('categories')
        .update({ ...toDatabaseRecord(record), updated_by: actorId })
        .eq('id', id)
        .select(CATEGORY_COLUMNS)
        .single(),
    );
    return parseCategory(data);
  }

  async setActive(id: string, isActive: boolean): Promise<Category> {
    return this.update(id, { isActive });
  }
}
