import type { StockOutputBatchInput, StockOutputReport } from '../domain/types';

export interface StockOutputRepository {
  consumeBatch(input: StockOutputBatchInput): Promise<StockOutputReport>;
}
