export interface StockAdjustmentInput {
  readonly productId: string;
  readonly quantityDelta: string;
  readonly locationId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly referenceMovementId?: string;
}

export interface StockAdjustmentReport {
  readonly movementId: string;
  readonly newBalance: string;
  readonly applied: boolean;
}
