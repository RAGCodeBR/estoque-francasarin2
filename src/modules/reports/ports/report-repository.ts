import type {
  ConsumptionReportPage,
  ConsumptionReportQuery,
  CurrentStockReportPage,
  CurrentStockReportQuery,
  EntryReportPage,
  EntryReportQuery,
  LossReportPage,
  LossReportQuery,
  MigrationReportPage,
  MigrationReportQuery,
  MovementReportPage,
  MovementReportQuery,
  ResolvedReportQuery,
} from '../domain/types';

export interface ReportRepository {
  currentStock(
    query: ResolvedReportQuery<CurrentStockReportQuery>,
  ): Promise<CurrentStockReportPage>;
  consumption(query: ResolvedReportQuery<ConsumptionReportQuery>): Promise<ConsumptionReportPage>;
  losses(query: ResolvedReportQuery<LossReportQuery>): Promise<LossReportPage>;
  entries(query: ResolvedReportQuery<EntryReportQuery>): Promise<EntryReportPage>;
  movements(query: ResolvedReportQuery<MovementReportQuery>): Promise<MovementReportPage>;
  migration(query: ResolvedReportQuery<MigrationReportQuery>): Promise<MigrationReportPage>;
}
