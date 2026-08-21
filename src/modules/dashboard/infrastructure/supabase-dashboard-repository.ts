import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSupabaseClient,
  isRecord,
  nullableString,
  numericString,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import {
  DASHBOARD_PERIODS,
  type DashboardCategoryRanking,
  type DashboardIndicators,
  type DashboardLocationRanking,
  type DashboardMovementIndicator,
  type DashboardMovementType,
  type DashboardPeriod,
  type DashboardProductRanking,
  type DashboardQuantity,
  type DashboardRecentMovement,
  type DashboardTrendPoint,
  type DashboardUnit,
  type InventoryDashboard,
  type ResolvedDashboardQuery,
} from '../domain/types';
import type { DashboardRepository } from '../ports/dashboard-repository';

const UNITS = ['UN', 'KG'] as const;
const MOVEMENT_TYPES = [
  'PURCHASE_ENTRY',
  'CONSUMPTION_EXIT',
  'LOSS',
  'ADJUSTMENT_POSITIVE',
  'ADJUSTMENT_NEGATIVE',
  'TRANSFER',
  'FRACTIONATION',
  'MIGRATION_OPENING_BALANCE',
] as const;

function record(value: unknown, context: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`${context} inválido na resposta do dashboard.`);
  return value;
}

function array(value: unknown, context: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} inválido na resposta do dashboard.`);
  return value;
}

function integer(source: Readonly<Record<string, unknown>>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Campo ${key} inválido na resposta do dashboard.`);
  }
  return value;
}

function unit(source: Readonly<Record<string, unknown>>): DashboardUnit {
  const value = requiredString(source, 'unit');
  if (!UNITS.includes(value as DashboardUnit)) {
    throw new Error('Unidade inválida na resposta do dashboard.');
  }
  return value as DashboardUnit;
}

function movementType(source: Readonly<Record<string, unknown>>): DashboardMovementType {
  const value = requiredString(source, 'movement_type');
  if (!MOVEMENT_TYPES.includes(value as DashboardMovementType)) {
    throw new Error('Tipo de movimento inválido na resposta do dashboard.');
  }
  return value as DashboardMovementType;
}

function quantity(value: unknown): DashboardQuantity {
  const source = record(value, 'Quantidade');
  return { unit: unit(source), quantity: numericString(source, 'quantity') };
}

function movementIndicator(value: unknown): DashboardMovementIndicator {
  const source = record(value, 'Indicador de movimentação');
  return {
    movementCount: integer(source, 'movement_count'),
    quantities: array(source.quantities, 'Quantidades').map(quantity),
  };
}

function indicators(value: unknown): DashboardIndicators {
  const source = record(value, 'Indicadores');
  return {
    activeProducts: integer(source, 'active_products'),
    belowMinimum: integer(source, 'below_minimum'),
    outOfStock: integer(source, 'out_of_stock'),
    entries: movementIndicator(source.entries),
    consumption: movementIndicator(source.consumption),
    losses: movementIndicator(source.losses),
    movements: integer(source, 'movements'),
  };
}

function trendPoint(value: unknown): DashboardTrendPoint {
  const source = record(value, 'Ponto de consumo');
  return {
    ...quantity(source),
    periodStart: requiredString(source, 'period_start'),
  };
}

function productRanking(value: unknown): DashboardProductRanking {
  const source = record(value, 'Ranking de produto');
  return {
    ...quantity(source),
    productId: requiredString(source, 'product_id'),
    productName: requiredString(source, 'product_name'),
    sku: requiredString(source, 'sku'),
  };
}

function categoryRanking(value: unknown): DashboardCategoryRanking {
  const source = record(value, 'Ranking de categoria');
  return {
    ...quantity(source),
    categoryId: nullableString(source, 'category_id'),
    categoryName: requiredString(source, 'category_name'),
  };
}

function locationRanking(value: unknown): DashboardLocationRanking {
  const source = record(value, 'Ranking de local');
  return {
    ...quantity(source),
    locationId: nullableString(source, 'location_id'),
    locationName: requiredString(source, 'location_name'),
  };
}

function recentMovement(value: unknown): DashboardRecentMovement {
  const source = record(value, 'Movimentação recente');
  return {
    ...quantity(source),
    id: requiredString(source, 'id'),
    productId: requiredString(source, 'product_id'),
    productName: requiredString(source, 'product_name'),
    sku: requiredString(source, 'sku'),
    movementType: movementType(source),
    sourceLocationId: nullableString(source, 'source_location_id'),
    sourceLocationName: nullableString(source, 'source_location_name'),
    destinationLocationId: nullableString(source, 'destination_location_id'),
    destinationLocationName: nullableString(source, 'destination_location_name'),
    responsibleName: requiredString(source, 'responsible_name'),
    reason: nullableString(source, 'reason'),
    createdAt: requiredString(source, 'created_at'),
  };
}

function parseDashboard(value: unknown): InventoryDashboard {
  const source = record(value, 'Dashboard');
  const periodDays = integer(source, 'period_days');
  if (!DASHBOARD_PERIODS.includes(periodDays as DashboardPeriod)) {
    throw new Error('Período inválido na resposta do dashboard.');
  }
  return {
    periodDays: periodDays as DashboardPeriod,
    periodStart: requiredString(source, 'period_start'),
    generatedAt: requiredString(source, 'generated_at'),
    indicators: indicators(source.indicators),
    consumptionTrend: array(source.consumption_trend, 'Série de consumo').map(trendPoint),
    topConsumed: array(source.top_consumed, 'Produtos mais consumidos').map(productRanking),
    lossesByCategory: array(source.losses_by_category, 'Perdas por categoria').map(categoryRanking),
    consumptionByLocation: array(source.consumption_by_location, 'Consumo por local').map(
      locationRanking,
    ),
    recentMovements: array(source.recent_movements, 'Movimentações recentes').map(recentMovement),
  };
}

export class SupabaseDashboardRepository implements DashboardRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async load(query: ResolvedDashboardQuery): Promise<InventoryDashboard> {
    return parseDashboard(
      await unwrapSupabaseResponse(
        this.client.rpc('get_inventory_dashboard', {
          p_days: query.periodDays,
          p_recent_limit: query.recentLimit,
        }),
      ),
    );
  }
}
