import type { StockAdjustmentInput, StockAdjustmentReport } from '../domain/adjustment-types';

export interface StockAdjustmentRepository {
  adjust(input: StockAdjustmentInput): Promise<StockAdjustmentReport>;
}
