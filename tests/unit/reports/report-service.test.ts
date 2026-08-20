import { describe, expect, it } from 'vitest';

import {
  ReportService,
  type ConsumptionReportPage,
  type ConsumptionReportQuery,
  type CurrentStockReportPage,
  type CurrentStockReportQuery,
  type EntryReportPage,
  type EntryReportQuery,
  type LossReportPage,
  type LossReportQuery,
  type MigrationReportPage,
  type MigrationReportQuery,
  type MovementReportPage,
  type MovementReportQuery,
  type ReportRepository,
  type ResolvedReportQuery,
} from '../../../src/modules/reports';

const ids = {
  product: 'b3000000-0000-4000-8000-000000000001',
  category: 'b3000000-0000-4000-8000-000000000002',
  location: 'b3000000-0000-4000-8000-000000000003',
  user: 'b3000000-0000-4000-8000-000000000004',
  reference: 'b3000000-0000-4000-8000-000000000005',
} as const;

function emptyPage(page: number, pageSize: number) {
  return { items: [], total: 0, totalPages: 0, page, pageSize };
}

class ReportRepositoryStub implements ReportRepository {
  readonly currentStockQueries: ResolvedReportQuery<CurrentStockReportQuery>[] = [];
  readonly consumptionQueries: ResolvedReportQuery<ConsumptionReportQuery>[] = [];
  readonly lossQueries: ResolvedReportQuery<LossReportQuery>[] = [];
  readonly entryQueries: ResolvedReportQuery<EntryReportQuery>[] = [];
  readonly movementQueries: ResolvedReportQuery<MovementReportQuery>[] = [];
  readonly migrationQueries: ResolvedReportQuery<MigrationReportQuery>[] = [];

  async currentStock(
    query: ResolvedReportQuery<CurrentStockReportQuery>,
  ): Promise<CurrentStockReportPage> {
    this.currentStockQueries.push(query);
    return Promise.resolve(emptyPage(query.page, query.pageSize));
  }

  async consumption(
    query: ResolvedReportQuery<ConsumptionReportQuery>,
  ): Promise<ConsumptionReportPage> {
    this.consumptionQueries.push(query);
    return Promise.resolve(emptyPage(query.page, query.pageSize));
  }

  async losses(query: ResolvedReportQuery<LossReportQuery>): Promise<LossReportPage> {
    this.lossQueries.push(query);
    return Promise.resolve(emptyPage(query.page, query.pageSize));
  }

  async entries(query: ResolvedReportQuery<EntryReportQuery>): Promise<EntryReportPage> {
    this.entryQueries.push(query);
    return Promise.resolve(emptyPage(query.page, query.pageSize));
  }

  async movements(query: ResolvedReportQuery<MovementReportQuery>): Promise<MovementReportPage> {
    this.movementQueries.push(query);
    return Promise.resolve(emptyPage(query.page, query.pageSize));
  }

  async migration(query: ResolvedReportQuery<MigrationReportQuery>): Promise<MigrationReportPage> {
    this.migrationQueries.push(query);
    return Promise.resolve(emptyPage(query.page, query.pageSize));
  }
}

describe('ReportService', () => {
  it('normaliza pesquisa, UUIDs, período e paginação antes de consultar o banco', async () => {
    const repository = new ReportRepositoryStub();
    const service = new ReportService(repository);
    await service.currentStock({
      search: '  arroz   integral ',
      categoryId: ids.category.toUpperCase(),
      situation: 'BELOW_MINIMUM',
      page: 2,
      pageSize: 50,
    });
    await service.movements({
      productId: ids.product.toUpperCase(),
      sourceLocationId: ids.location.toUpperCase(),
      createdBy: ids.user.toUpperCase(),
      referenceId: ids.reference.toUpperCase(),
      movementType: 'CONSUMPTION_EXIT',
      createdFrom: '2026-08-20T08:00:00-03:00',
      createdTo: '2026-08-20T13:00:00Z',
    });

    expect(repository.currentStockQueries).toEqual([
      {
        search: 'arroz integral',
        categoryId: ids.category,
        situation: 'BELOW_MINIMUM',
        page: 2,
        pageSize: 50,
      },
    ]);
    expect(repository.movementQueries).toEqual([
      {
        productId: ids.product,
        sourceLocationId: ids.location,
        createdBy: ids.user,
        referenceId: ids.reference,
        movementType: 'CONSUMPTION_EXIT',
        createdFrom: '2026-08-20T11:00:00.000Z',
        createdTo: '2026-08-20T13:00:00.000Z',
        page: 1,
        pageSize: 25,
      },
    ]);
  });

  it('normaliza filtros próprios de entradas e migração', async () => {
    const repository = new ReportRepositoryStub();
    const service = new ReportService(repository);
    await service.entries({ supplierId: ids.user, invoiceId: ids.reference });
    await service.migration({ importBatchId: ids.reference, source: '  sistema   antigo ' });
    expect(repository.entryQueries[0]).toMatchObject({
      supplierId: ids.user,
      invoiceId: ids.reference,
      page: 1,
      pageSize: 25,
    });
    expect(repository.migrationQueries[0]).toMatchObject({
      importBatchId: ids.reference,
      source: 'sistema antigo',
      page: 1,
      pageSize: 25,
    });
  });

  it('rejeita paginação, UUID, timezone e intervalo inválidos sem consultar o repositório', async () => {
    const repository = new ReportRepositoryStub();
    const service = new ReportService(repository);
    await expect(service.currentStock({ pageSize: 101 })).rejects.toThrow(/entre 1 e 100/);
    await expect(service.losses({ productId: 'inválido' })).rejects.toThrow(/UUID válido/);
    await expect(service.consumption({ createdFrom: '2026-08-20' })).rejects.toThrow(
      /fuso explícitos/,
    );
    await expect(
      service.entries({
        issuedFrom: '2026-08-21T00:00:00Z',
        issuedTo: '2026-08-20T00:00:00Z',
      }),
    ).rejects.toThrow(/não pode ser posterior/);
    expect(repository.currentStockQueries).toEqual([]);
    expect(repository.lossQueries).toEqual([]);
    expect(repository.consumptionQueries).toEqual([]);
    expect(repository.entryQueries).toEqual([]);
  });
});
