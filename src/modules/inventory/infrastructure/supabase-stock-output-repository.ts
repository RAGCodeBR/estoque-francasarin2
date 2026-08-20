import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSupabaseClient,
  isRecord,
  numericString,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import type {
  StockOutputBatchInput,
  StockOutputItemResult,
  StockOutputReport,
  StockUnit,
} from '../domain/types';
import type { StockOutputRepository } from '../ports/stock-output-repository';

function requiredInteger(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
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

function parseItem(value: unknown): StockOutputItemResult {
  if (!isRecord(value)) throw new Error('Item inválido no relatório de saída.');
  return {
    lineNumber: requiredInteger(value, 'lineNumber'),
    movementId: requiredString(value, 'movementId'),
    productId: requiredString(value, 'productId'),
    quantity: numericString(value, 'quantity'),
    unit: requiredUnit(value, 'unit'),
    newBalance: numericString(value, 'newBalance'),
    destinationLocationId: requiredString(value, 'destinationLocationId'),
    createdAt: requiredString(value, 'createdAt'),
    createdBy: requiredString(value, 'createdBy'),
  };
}

function parseReport(value: unknown): StockOutputReport {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('Relatório inválido após confirmação da saída.');
  }

  const items: readonly unknown[] = value.items;
  return {
    batchId: requiredString(value, 'batchId'),
    sourceLocationId: requiredString(value, 'sourceLocationId'),
    destinationLocationId: requiredString(value, 'destinationLocationId'),
    idempotencyKey: requiredString(value, 'idempotencyKey'),
    reason: requiredString(value, 'reason'),
    createdAt: requiredString(value, 'createdAt'),
    createdBy: requiredString(value, 'createdBy'),
    movementCount: requiredInteger(value, 'movementCount'),
    applied: requiredBoolean(value, 'applied'),
    items: items.map(parseItem),
  };
}

export class SupabaseStockOutputRepository implements StockOutputRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async consumeBatch(input: StockOutputBatchInput): Promise<StockOutputReport> {
    const data = await unwrapSupabaseResponse(
      this.client.rpc('consume_stock_batch', {
        p_source_location_id: input.sourceLocationId,
        p_destination_location_id: input.destinationLocationId,
        p_items: input.items.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity,
        })),
        p_idempotency_key: input.idempotencyKey,
        p_reason: input.reason ?? null,
      }),
    );
    return parseReport(data);
  }
}
