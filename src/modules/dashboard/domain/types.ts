export const DASHBOARD_PERIODS = [7, 30, 90] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export type DashboardUnit = 'UN' | 'KG';
export type DashboardMovementType =
  | 'PURCHASE_ENTRY'
  | 'CONSUMPTION_EXIT'
  | 'LOSS'
  | 'ADJUSTMENT_POSITIVE'
  | 'ADJUSTMENT_NEGATIVE'
  | 'TRANSFER'
  | 'FRACTIONATION'
  | 'MIGRATION_OPENING_BALANCE';

export interface DashboardQuantity {
  readonly unit: DashboardUnit;
  readonly quantity: string;
}

export interface DashboardMovementIndicator {
  readonly movementCount: number;
  readonly quantities: readonly DashboardQuantity[];
}

export interface DashboardIndicators {
  readonly activeProducts: number;
  readonly belowMinimum: number;
  readonly outOfStock: number;
  readonly entries: DashboardMovementIndicator;
  readonly consumption: DashboardMovementIndicator;
  readonly losses: DashboardMovementIndicator;
  readonly movements: number;
}

export interface DashboardTrendPoint extends DashboardQuantity {
  readonly periodStart: string;
}

export interface DashboardProductRanking extends DashboardQuantity {
  readonly productId: string;
  readonly productName: string;
  readonly sku: string;
}

export interface DashboardCategoryRanking extends DashboardQuantity {
  readonly categoryId: string | null;
  readonly categoryName: string;
}

export interface DashboardLocationRanking extends DashboardQuantity {
  readonly locationId: string | null;
  readonly locationName: string;
}

export interface DashboardRecentMovement extends DashboardQuantity {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly sku: string;
  readonly movementType: DashboardMovementType;
  readonly sourceLocationId: string | null;
  readonly sourceLocationName: string | null;
  readonly destinationLocationId: string | null;
  readonly destinationLocationName: string | null;
  readonly responsibleName: string;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface InventoryDashboard {
  readonly periodDays: DashboardPeriod;
  readonly periodStart: string;
  readonly generatedAt: string;
  readonly indicators: DashboardIndicators;
  readonly consumptionTrend: readonly DashboardTrendPoint[];
  readonly topConsumed: readonly DashboardProductRanking[];
  readonly lossesByCategory: readonly DashboardCategoryRanking[];
  readonly consumptionByLocation: readonly DashboardLocationRanking[];
  readonly recentMovements: readonly DashboardRecentMovement[];
}

export interface DashboardQuery {
  readonly periodDays?: DashboardPeriod;
  readonly recentLimit?: number;
}

export interface ResolvedDashboardQuery {
  readonly periodDays: DashboardPeriod;
  readonly recentLimit: number;
}
