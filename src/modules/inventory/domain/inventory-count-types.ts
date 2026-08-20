import type { StockUnit } from './types';

export type InventoryCountStatus = 'DRAFT' | 'COUNTING' | 'REVIEW' | 'CONFIRMED';

export interface CreateInventoryCountInput {
  readonly locationId: string;
  readonly reference?: string;
  readonly notes?: string;
}

export interface InventoryCountItemInput {
  readonly productId: string;
  readonly countedQuantity: string;
}

export interface SaveInventoryCountItemsInput {
  readonly inventoryCountId: string;
  readonly items: readonly InventoryCountItemInput[];
  readonly replace?: boolean;
}

export interface InventoryCountItem {
  readonly itemId: string;
  readonly productId: string;
  readonly unit: StockUnit;
  readonly countedQuantity: string;
  readonly systemQuantity: string | null;
  readonly differenceQuantity: string | null;
  readonly movementId: string | null;
  readonly countedAt: string;
  readonly countedBy: string;
}

export interface InventoryCountReport {
  readonly inventoryCountId: string;
  readonly locationId: string;
  readonly status: InventoryCountStatus;
  readonly reference: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly startedAt: string | null;
  readonly startedBy: string | null;
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
  readonly confirmedAt: string | null;
  readonly confirmedBy: string | null;
  readonly confirmationIdempotencyKey: string | null;
  readonly itemCount: number;
  readonly positiveAdjustments: number;
  readonly negativeAdjustments: number;
  readonly unchangedItems: number;
  readonly movementsCreated: number;
  readonly applied: boolean;
  readonly items: readonly InventoryCountItem[];
}
