import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSupabaseClient,
  isRecord,
  nullableString,
  numericString,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import type {
  CreateInventoryCountInput,
  InventoryCountItem,
  InventoryCountItemInput,
  InventoryCountReport,
  InventoryCountStatus,
} from '../domain/inventory-count-types';
import type { StockUnit } from '../domain/types';
import type { InventoryCountRepository } from '../ports/inventory-count-repository';

function requiredInteger(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Campo ${key} inválido na resposta do banco.`);
  }
  return value;
}

function requiredStatus(
  record: Readonly<Record<string, unknown>>,
  key: string,
): InventoryCountStatus {
  const value = record[key];
  if (value !== 'DRAFT' && value !== 'COUNTING' && value !== 'REVIEW' && value !== 'CONFIRMED') {
    throw new Error(`Campo ${key} inválido na resposta do banco.`);
  }
  return value;
}

function requiredUnit(record: Readonly<Record<string, unknown>>, key: string): StockUnit {
  const value = record[key];
  if (value !== 'UN' && value !== 'KG') {
    throw new Error(`Campo ${key} inválido na resposta do banco.`);
  }
  return value;
}

function nullableNumeric(record: Readonly<Record<string, unknown>>, key: string): string | null {
  if (record[key] === null) return null;
  const value = record[key];
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,3})?$/.test(value)) {
    throw new Error(`Campo ${key} inválido na resposta do banco.`);
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer = '0', fraction = ''] = unsigned.split('.');
  return `${negative ? '-' : ''}${integer}.${fraction.padEnd(3, '0')}`;
}

function parseItem(value: unknown): InventoryCountItem {
  if (!isRecord(value)) throw new Error('Item inválido no relatório de inventário.');
  return {
    itemId: requiredString(value, 'itemId'),
    productId: requiredString(value, 'productId'),
    unit: requiredUnit(value, 'unit'),
    countedQuantity: numericString(value, 'countedQuantity'),
    systemQuantity: nullableNumeric(value, 'systemQuantity'),
    differenceQuantity: nullableNumeric(value, 'differenceQuantity'),
    movementId: nullableString(value, 'movementId'),
    countedAt: requiredString(value, 'countedAt'),
    countedBy: requiredString(value, 'countedBy'),
  };
}

function parseReport(value: unknown): InventoryCountReport {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('Relatório inválido de inventário.');
  }
  const items: readonly unknown[] = value.items;
  return {
    inventoryCountId: requiredString(value, 'inventoryCountId'),
    locationId: requiredString(value, 'locationId'),
    status: requiredStatus(value, 'status'),
    reference: nullableString(value, 'reference'),
    notes: nullableString(value, 'notes'),
    createdAt: requiredString(value, 'createdAt'),
    createdBy: requiredString(value, 'createdBy'),
    startedAt: nullableString(value, 'startedAt'),
    startedBy: nullableString(value, 'startedBy'),
    reviewedAt: nullableString(value, 'reviewedAt'),
    reviewedBy: nullableString(value, 'reviewedBy'),
    confirmedAt: nullableString(value, 'confirmedAt'),
    confirmedBy: nullableString(value, 'confirmedBy'),
    confirmationIdempotencyKey: nullableString(value, 'confirmationIdempotencyKey'),
    itemCount: requiredInteger(value, 'itemCount'),
    positiveAdjustments: requiredInteger(value, 'positiveAdjustments'),
    negativeAdjustments: requiredInteger(value, 'negativeAdjustments'),
    unchangedItems: requiredInteger(value, 'unchangedItems'),
    movementsCreated: requiredInteger(value, 'movementsCreated'),
    applied: requiredBoolean(value, 'applied'),
    items: items.map(parseItem),
  };
}

export class SupabaseInventoryCountRepository implements InventoryCountRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async create(input: CreateInventoryCountInput): Promise<InventoryCountReport> {
    const data = await unwrapSupabaseResponse(
      this.client.rpc('create_inventory_count', {
        p_location_id: input.locationId,
        p_reference: input.reference ?? null,
        p_notes: input.notes ?? null,
      }),
    );
    return parseReport(data);
  }

  async open(inventoryCountId: string): Promise<InventoryCountReport> {
    return parseReport(
      await unwrapSupabaseResponse(
        this.client.rpc('open_inventory_count', { p_inventory_count_id: inventoryCountId }),
      ),
    );
  }

  async saveItems(
    inventoryCountId: string,
    items: readonly InventoryCountItemInput[],
    replace: boolean,
  ): Promise<InventoryCountReport> {
    const data = await unwrapSupabaseResponse(
      this.client.rpc('save_inventory_count_items', {
        p_inventory_count_id: inventoryCountId,
        p_items: items.map((item) => ({
          product_id: item.productId,
          counted_quantity: item.countedQuantity,
        })),
        p_replace: replace,
      }),
    );
    return parseReport(data);
  }

  async review(inventoryCountId: string): Promise<InventoryCountReport> {
    return parseReport(
      await unwrapSupabaseResponse(
        this.client.rpc('review_inventory_count', { p_inventory_count_id: inventoryCountId }),
      ),
    );
  }

  async confirm(inventoryCountId: string, idempotencyKey: string): Promise<InventoryCountReport> {
    return parseReport(
      await unwrapSupabaseResponse(
        this.client.rpc('confirm_inventory_count', {
          p_inventory_count_id: inventoryCountId,
          p_idempotency_key: idempotencyKey,
        }),
      ),
    );
  }
}
