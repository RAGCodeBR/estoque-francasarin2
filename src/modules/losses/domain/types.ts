export type LossUnit = 'UN' | 'KG';

export interface RegisterLossInput {
  readonly productId: string;
  readonly quantity: string;
  readonly locationId: string;
  readonly reason: string;
  readonly notes?: string;
  readonly idempotencyKey: string;
}

export interface StockLossReport {
  readonly lossId: string;
  readonly movementId: string;
  readonly productId: string;
  readonly quantity: string;
  readonly unit: LossUnit;
  readonly locationId: string;
  readonly reason: string;
  readonly notes: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly newBalance: string;
  readonly applied: boolean;
}
