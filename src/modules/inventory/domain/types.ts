export type StockUnit = 'UN' | 'KG';

export interface StockOutputItemInput {
  readonly productId: string;
  readonly quantity: string;
}

export interface StockOutputInput extends StockOutputItemInput {
  readonly sourceLocationId: string;
  readonly destinationLocationId: string;
  readonly idempotencyKey: string;
  readonly reason?: string;
}

export interface StockOutputBatchInput {
  readonly sourceLocationId: string;
  readonly destinationLocationId: string;
  readonly idempotencyKey: string;
  readonly reason?: string;
  readonly items: readonly StockOutputItemInput[];
}

export interface StockOutputItemResult {
  readonly lineNumber: number;
  readonly movementId: string;
  readonly productId: string;
  readonly quantity: string;
  readonly unit: StockUnit;
  readonly newBalance: string;
  readonly destinationLocationId: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface StockOutputReport {
  readonly batchId: string;
  readonly sourceLocationId: string;
  readonly destinationLocationId: string;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly movementCount: number;
  readonly applied: boolean;
  readonly items: readonly StockOutputItemResult[];
}
