import type { RegisterLossInput, StockLossReport } from '../domain/types';

export interface LossRepository {
  register(input: RegisterLossInput): Promise<StockLossReport>;
}
