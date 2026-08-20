import { describe, expect, it } from 'vitest';

import {
  AuditService,
  type AdministrativeExportAuditInput,
  type AdministrativeExportAuditReport,
  type AuditLogPage,
  type AuditLogSearch,
  type AuditRepository,
} from '../../../src/modules/audit';

const ids = {
  actor: 'a1000000-0000-4000-8000-000000000001',
  request: 'a1000000-0000-4000-8000-000000000002',
  log: 'a1000000-0000-4000-8000-000000000003',
  export: 'a1000000-0000-4000-8000-000000000004',
} as const;

class AuditRepositoryStub implements AuditRepository {
  readonly searches: AuditLogSearch[] = [];
  readonly exports: AdministrativeExportAuditInput[] = [];

  async search(query: AuditLogSearch): Promise<AuditLogPage> {
    this.searches.push(query);
    return Promise.resolve({ items: [], total: 0, totalPages: 0, page: 1, pageSize: 50 });
  }

  async recordAdministrativeExport(
    input: AdministrativeExportAuditInput,
  ): Promise<AdministrativeExportAuditReport> {
    this.exports.push(input);
    return Promise.resolve({
      auditLogId: ids.log,
      exportId: ids.export,
      createdAt: '2026-08-20T12:00:00.000Z',
      applied: true,
    });
  }
}

describe('AuditService', () => {
  it('normaliza filtros e paginação antes da consulta server-side', async () => {
    const repository = new AuditRepositoryStub();
    const service = new AuditService(repository);

    await service.search({
      action: ' PRODUCT_UPDATED ',
      entityType: ' product ',
      entityId: ' item-1 ',
      actorId: ids.actor.toUpperCase(),
      requestId: ids.request.toUpperCase(),
      createdFrom: '2026-08-20T08:00:00-03:00',
      createdTo: '2026-08-20T13:00:00Z',
      page: 2,
      pageSize: 75,
    });

    expect(repository.searches).toEqual([
      {
        action: 'PRODUCT_UPDATED',
        entityType: 'product',
        entityId: 'item-1',
        actorId: ids.actor,
        requestId: ids.request,
        createdFrom: '2026-08-20T11:00:00.000Z',
        createdTo: '2026-08-20T13:00:00.000Z',
        page: 2,
        pageSize: 75,
      },
    ]);
  });

  it('rejeita página excessiva e intervalo de data invertido', async () => {
    const repository = new AuditRepositoryStub();
    const service = new AuditService(repository);
    await expect(service.search({ pageSize: 101 })).rejects.toThrow(/entre 1 e 100/);
    await expect(
      service.search({
        createdFrom: '2026-08-21T00:00:00Z',
        createdTo: '2026-08-20T00:00:00Z',
      }),
    ).rejects.toThrow(/não pode ser posterior/);
    expect(repository.searches).toEqual([]);
  });

  it('registra apenas metadados estruturados da exportação e normaliza idempotência', async () => {
    const repository = new AuditRepositoryStub();
    const service = new AuditService(repository);
    await service.recordAdministrativeExport({
      exportType: 'AUDIT_LOGS',
      format: 'CSV',
      rowCount: 120,
      idempotencyKey: ' export:audit:1 ',
    });
    expect(repository.exports).toEqual([
      {
        exportType: 'AUDIT_LOGS',
        format: 'CSV',
        rowCount: 120,
        idempotencyKey: 'export:audit:1',
      },
    ]);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejeita quantidade exportada inválida %s',
    async (rowCount) => {
      const repository = new AuditRepositoryStub();
      const service = new AuditService(repository);
      await expect(
        service.recordAdministrativeExport({
          exportType: 'PRODUCTS',
          format: 'XLSX',
          rowCount,
          idempotencyKey: 'export:invalid',
        }),
      ).rejects.toThrow(/inteiro não negativo/);
      expect(repository.exports).toEqual([]);
    },
  );
});
