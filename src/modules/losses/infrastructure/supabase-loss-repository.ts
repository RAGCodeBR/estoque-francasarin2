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
import type { LossUnit, RegisterLossInput, StockLossReport } from '../domain/types';
import type { LossRepository } from '../ports/loss-repository';

function requiredUnit(record: Readonly<Record<string, unknown>>, key: string): LossUnit {
  const value = record[key];
  if (value !== 'UN' && value !== 'KG') {
    throw new Error(`Campo ${key} inválido na resposta do banco.`);
  }
  return value;
}

function parseReport(value: unknown): StockLossReport {
  if (!isRecord(value)) throw new Error('Relatório inválido após registrar perda.');
  return {
    lossId: requiredString(value, 'lossId'),
    movementId: requiredString(value, 'movementId'),
    productId: requiredString(value, 'productId'),
    quantity: numericString(value, 'quantity'),
    unit: requiredUnit(value, 'unit'),
    locationId: requiredString(value, 'locationId'),
    reason: requiredString(value, 'reason'),
    notes: nullableString(value, 'notes'),
    idempotencyKey: requiredString(value, 'idempotencyKey'),
    createdAt: requiredString(value, 'createdAt'),
    createdBy: requiredString(value, 'createdBy'),
    newBalance: numericString(value, 'newBalance'),
    applied: requiredBoolean(value, 'applied'),
  };
}

export class SupabaseLossRepository implements LossRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async register(input: RegisterLossInput): Promise<StockLossReport> {
    const data = await unwrapSupabaseResponse(
      this.client.rpc('register_stock_loss', {
        p_product_id: input.productId,
        p_quantity: input.quantity,
        p_location_id: input.locationId,
        p_reason: input.reason,
        p_notes: input.notes ?? null,
        p_idempotency_key: input.idempotencyKey,
      }),
    );
    return parseReport(data);
  }
}
