import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { SupabaseDashboardRepository } from '../../../src/modules/dashboard';

function payload() {
  return {
    period_days: 7,
    period_start: '2026-08-15T03:00:00Z',
    generated_at: '2026-08-21T12:00:00Z',
    indicators: {
      active_products: 4,
      below_minimum: 1,
      out_of_stock: 1,
      entries: { movement_count: 1, quantities: [{ unit: 'KG', quantity: '2.5' }] },
      consumption: { movement_count: 0, quantities: [] },
      losses: { movement_count: 0, quantities: [] },
      movements: 1,
    },
    consumption_trend: [{ period_start: '2026-08-15', unit: 'KG', quantity: 0 }],
    top_consumed: [],
    losses_by_category: [],
    consumption_by_location: [],
    recent_movements: [],
  };
}

describe('SupabaseDashboardRepository', () => {
  it('chama somente o RPC agregado e valida seu contrato', async () => {
    const calls: unknown[] = [];
    const client = {
      rpc(name: string, parameters: unknown) {
        calls.push([name, parameters]);
        return Promise.resolve({ data: payload(), error: null });
      },
    } as unknown as SupabaseClient;
    const repository = new SupabaseDashboardRepository(client);

    const result = await repository.load({ periodDays: 7, recentLimit: 5 });

    expect(calls).toEqual([['get_inventory_dashboard', { p_days: 7, p_recent_limit: 5 }]]);
    expect(result).toMatchObject({
      periodDays: 7,
      indicators: { activeProducts: 4, entries: { movementCount: 1 } },
      consumptionTrend: [{ unit: 'KG', quantity: '0.000' }],
    });
    expect(result.indicators.entries.quantities).toEqual([{ unit: 'KG', quantity: '2.500' }]);
  });

  it('recusa payload inesperado em vez de exibir métricas incorretas', async () => {
    const invalid = payload();
    invalid.indicators.active_products = -1;
    const client = {
      rpc: () => Promise.resolve({ data: invalid, error: null }),
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseDashboardRepository(client).load({ periodDays: 7, recentLimit: 8 }),
    ).rejects.toThrow(/active_products inválido/);
  });
});
