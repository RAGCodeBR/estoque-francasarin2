import {
  DASHBOARD_PERIODS,
  type DashboardPeriod,
  type DashboardQuery,
  type InventoryDashboard,
} from '../domain/types';
import type { DashboardRepository } from '../ports/dashboard-repository';

function period(value: unknown): DashboardPeriod {
  if (typeof value !== 'number' || !DASHBOARD_PERIODS.includes(value as DashboardPeriod)) {
    throw new Error('Período do dashboard deve ser 7, 30 ou 90 dias.');
  }
  return value as DashboardPeriod;
}

export class DashboardService {
  constructor(private readonly repository: DashboardRepository) {}

  load(query: DashboardQuery = {}): Promise<InventoryDashboard> {
    const periodDays = period(query.periodDays ?? 30);
    const recentLimit = query.recentLimit ?? 8;
    if (!Number.isSafeInteger(recentLimit) || recentLimit < 1 || recentLimit > 20) {
      throw new Error('Limite de movimentações recentes deve estar entre 1 e 20.');
    }
    return this.repository.load({ periodDays, recentLimit });
  }
}
