import { describe, expect, it } from 'vitest';

import {
  DashboardService,
  type DashboardRepository,
  type InventoryDashboard,
  type ResolvedDashboardQuery,
} from '../../../src/modules/dashboard';

const emptyDashboard: InventoryDashboard = {
  periodDays: 30,
  periodStart: '2026-07-23T03:00:00.000Z',
  generatedAt: '2026-08-21T12:00:00.000Z',
  indicators: {
    activeProducts: 0,
    belowMinimum: 0,
    outOfStock: 0,
    entries: { movementCount: 0, quantities: [] },
    consumption: { movementCount: 0, quantities: [] },
    losses: { movementCount: 0, quantities: [] },
    movements: 0,
  },
  consumptionTrend: [],
  topConsumed: [],
  lossesByCategory: [],
  consumptionByLocation: [],
  recentMovements: [],
};

class DashboardRepositoryStub implements DashboardRepository {
  readonly queries: ResolvedDashboardQuery[] = [];

  load(query: ResolvedDashboardQuery): Promise<InventoryDashboard> {
    this.queries.push(query);
    return Promise.resolve({ ...emptyDashboard, periodDays: query.periodDays });
  }
}

describe('DashboardService', () => {
  it('usa período e limite seguros por padrão', async () => {
    const repository = new DashboardRepositoryStub();
    const service = new DashboardService(repository);

    await expect(service.load()).resolves.toMatchObject({ periodDays: 30 });
    expect(repository.queries).toEqual([{ periodDays: 30, recentLimit: 8 }]);
  });

  it('aceita somente os períodos previstos e limita o histórico recente', async () => {
    const repository = new DashboardRepositoryStub();
    const service = new DashboardService(repository);

    await service.load({ periodDays: 90, recentLimit: 20 });
    expect(repository.queries).toEqual([{ periodDays: 90, recentLimit: 20 }]);
    expect(() => service.load({ periodDays: 14 as 7 })).toThrow(/7, 30 ou 90/);
    expect(() => service.load({ recentLimit: 0 })).toThrow(/entre 1 e 20/);
    expect(repository.queries).toHaveLength(1);
  });
});
