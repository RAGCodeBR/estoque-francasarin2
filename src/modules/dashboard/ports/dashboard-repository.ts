import type { InventoryDashboard, ResolvedDashboardQuery } from '../domain/types';

export interface DashboardRepository {
  load(query: ResolvedDashboardQuery): Promise<InventoryDashboard>;
}
