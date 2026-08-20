import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getAuthenticatedUserId,
  getSupabaseClient,
  isRecord,
  nullableString,
  numericString,
  parsePagePayload,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import { createPaginatedResult } from '../../../types/pagination';
import type {
  Product,
  ProductCategory,
  ProductCreateRecord,
  ProductPage,
  ProductSearch,
  ProductType,
  ProductUpdateRecord,
  UnitType,
} from '../domain/types';
import type { ProductRepository } from '../ports/product-repository';

function parseProductType(value: string): ProductType {
  if (value !== 'RAW' && value !== 'FRACTIONATED') {
    throw new Error('Tipo de produto inválido na resposta do banco.');
  }
  return value;
}

function parseUnit(value: string): UnitType {
  if (value !== 'UN' && value !== 'KG') {
    throw new Error('Unidade inválida na resposta do banco.');
  }
  return value;
}

function parseCategory(value: unknown): ProductCategory {
  let category: unknown = value;
  if (Array.isArray(value)) {
    const categories: readonly unknown[] = value;
    category = categories[0];
  }
  if (!isRecord(category)) throw new Error('Categoria inválida na resposta do produto.');
  return { id: requiredString(category, 'id'), name: requiredString(category, 'name') };
}

function parseProduct(value: unknown): Product {
  if (!isRecord(value)) throw new Error('Produto inválido na resposta do banco.');
  return {
    id: requiredString(value, 'id'),
    name: requiredString(value, 'name'),
    sku: requiredString(value, 'sku'),
    ean: nullableString(value, 'ean'),
    productType: parseProductType(requiredString(value, 'product_type')),
    unit: parseUnit(requiredString(value, 'unit')),
    category: parseCategory(value.category),
    minimumQuantity: numericString(value, 'minimum_quantity'),
    isActive: requiredBoolean(value, 'is_active'),
    createdAt: requiredString(value, 'created_at'),
    updatedAt: requiredString(value, 'updated_at'),
  };
}

function toDatabaseRecord(record: ProductCreateRecord | ProductUpdateRecord) {
  return {
    ...(record.name === undefined ? {} : { name: record.name }),
    ...(record.sku === undefined ? {} : { sku: record.sku }),
    ...(record.ean === undefined ? {} : { ean: record.ean }),
    ...(record.categoryId === undefined ? {} : { category_id: record.categoryId }),
    ...(record.productType === undefined ? {} : { product_type: record.productType }),
    ...(record.unit === undefined ? {} : { unit: record.unit }),
    ...(record.minimumQuantity !== undefined ? { minimum_quantity: record.minimumQuantity } : {}),
    ...('isActive' in record ? { is_active: record.isActive } : {}),
  };
}

export class SupabaseProductRepository implements ProductRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async create(record: ProductCreateRecord): Promise<Product> {
    const actorId = await getAuthenticatedUserId(this.client);
    const data = await unwrapSupabaseResponse(
      this.client
        .from('products')
        .insert({ ...toDatabaseRecord(record), created_by: actorId, updated_by: actorId })
        .select('id')
        .single(),
    );
    if (!isRecord(data)) throw new Error('Produto inválido após criação.');
    const product = await this.getById(requiredString(data, 'id'));
    if (!product) throw new Error('Produto criado não foi encontrado.');
    return product;
  }

  async getById(id: string): Promise<Product | null> {
    const data = await unwrapSupabaseResponse(this.client.rpc('get_product', { p_product_id: id }));
    return data === null ? null : parseProduct(data);
  }

  async search(query: ProductSearch): Promise<ProductPage> {
    const payload = parsePagePayload(
      await unwrapSupabaseResponse(
        this.client.rpc('search_products', {
          p_search: query.search ?? null,
          p_category_id: query.categoryId ?? null,
          p_product_type: query.productType ?? null,
          p_unit: query.unit ?? null,
          p_is_active: query.isActive ?? null,
          p_page: query.page,
          p_page_size: query.pageSize,
        }),
      ),
    );
    return createPaginatedResult(
      payload.items.map(parseProduct),
      payload.total,
      payload.page,
      payload.pageSize,
    );
  }

  async update(id: string, record: ProductUpdateRecord): Promise<Product> {
    const actorId = await getAuthenticatedUserId(this.client);
    const data = await unwrapSupabaseResponse(
      this.client
        .from('products')
        .update({ ...toDatabaseRecord(record), updated_by: actorId })
        .eq('id', id)
        .select('id')
        .single(),
    );
    if (!isRecord(data)) throw new Error('Produto inválido após edição.');
    const product = await this.getById(requiredString(data, 'id'));
    if (!product) throw new Error('Produto editado não foi encontrado.');
    return product;
  }

  async setActive(id: string, isActive: boolean): Promise<Product> {
    return this.update(id, { isActive });
  }
}
