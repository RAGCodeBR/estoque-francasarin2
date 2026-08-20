import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSupabaseClient,
  isRecord,
  numericString,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import type { StockAdjustmentInput, StockAdjustmentReport } from '../domain/adjustment-types';
import type { StockAdjustmentRepository } from '../ports/stock-adjustment-repository';

function parseReport(value: unknown): StockAdjustmentReport {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error('Relatório inválido após ajuste de estoque.');
  }
  const row = value[0];
  return {
    movementId: requiredString(row, 'movement_id'),
    newBalance: numericString(row, 'new_balance'),
    applied: requiredBoolean(row, 'applied'),
  };
}

export class SupabaseStockAdjustmentRepository implements StockAdjustmentRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async adjust(input: StockAdjustmentInput): Promise<StockAdjustmentReport> {
    const data = await unwrapSupabaseResponse(
      this.client.rpc('adjust_stock', {
        p_product_id: input.productId,
        p_quantity_delta: input.quantityDelta,
        p_location_id: input.locationId,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
        p_reference_movement_id: input.referenceMovementId ?? null,
      }),
    );
    return parseReport(data);
  }
}
