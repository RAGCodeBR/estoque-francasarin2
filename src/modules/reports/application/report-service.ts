import { resolvePageRequest } from '../../../types/pagination';
import { assertUuid, normalizeSearch } from '../../../utils/domain-values';
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
} from '../domain/types';
import type { ReportRepository } from '../ports/report-repository';

function timestamp(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${field} deve conter data, hora e fuso explícitos.`);
  }
  return new Date(normalized).toISOString();
}

function uuid(value: string | undefined, field: string): string | undefined {
  return value === undefined ? undefined : assertUuid(value, field);
}

function dateRange(
  from: string | undefined,
  to: string | undefined,
): {
  createdFrom?: string;
  createdTo?: string;
} {
  const createdFrom = timestamp(from, 'Data inicial');
  const createdTo = timestamp(to, 'Data final');
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new Error('Data inicial não pode ser posterior à data final.');
  }
  return {
    ...(createdFrom === undefined ? {} : { createdFrom }),
    ...(createdTo === undefined ? {} : { createdTo }),
  };
}

export class ReportService {
  constructor(private readonly repository: ReportRepository) {}

  async currentStock(query: CurrentStockReportQuery = {}): Promise<CurrentStockReportPage> {
    const page = resolvePageRequest(query);
    const search = normalizeSearch(query.search);
    const categoryId = uuid(query.categoryId, 'ID da categoria');
    return await this.repository.currentStock({
      ...page,
      ...(search === undefined ? {} : { search }),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(query.productType === undefined ? {} : { productType: query.productType }),
      ...(query.unit === undefined ? {} : { unit: query.unit }),
      ...(query.situation === undefined ? {} : { situation: query.situation }),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    });
  }

  async consumption(query: ConsumptionReportQuery = {}): Promise<ConsumptionReportPage> {
    const locationId = uuid(query.locationId, 'ID do local');
    return await this.repository.consumption({
      ...resolvePageRequest(query),
      ...dateRange(query.createdFrom, query.createdTo),
      ...this.masterFilters(query),
      ...(locationId === undefined ? {} : { locationId }),
    });
  }

  async losses(query: LossReportQuery = {}): Promise<LossReportPage> {
    const createdBy = uuid(query.createdBy, 'ID do usuário');
    const locationId = uuid(query.locationId, 'ID do local');
    return await this.repository.losses({
      ...resolvePageRequest(query),
      ...dateRange(query.createdFrom, query.createdTo),
      ...this.masterFilters(query),
      ...(locationId === undefined ? {} : { locationId }),
      ...(createdBy === undefined ? {} : { createdBy }),
    });
  }

  async entries(query: EntryReportQuery = {}): Promise<EntryReportPage> {
    const issued = dateRange(query.issuedFrom, query.issuedTo);
    const supplierId = uuid(query.supplierId, 'ID do fornecedor');
    const invoiceId = uuid(query.invoiceId, 'ID da nota fiscal');
    return await this.repository.entries({
      ...resolvePageRequest(query),
      ...(issued.createdFrom === undefined ? {} : { issuedFrom: issued.createdFrom }),
      ...(issued.createdTo === undefined ? {} : { issuedTo: issued.createdTo }),
      ...this.masterFilters(query),
      ...(supplierId === undefined ? {} : { supplierId }),
      ...(invoiceId === undefined ? {} : { invoiceId }),
    });
  }

  async movements(query: MovementReportQuery = {}): Promise<MovementReportPage> {
    const sourceLocationId = uuid(query.sourceLocationId, 'ID do local de origem');
    const destinationLocationId = uuid(query.destinationLocationId, 'ID do local de destino');
    const createdBy = uuid(query.createdBy, 'ID do usuário');
    const referenceId = uuid(query.referenceId, 'ID da referência');
    return await this.repository.movements({
      ...resolvePageRequest(query),
      ...dateRange(query.createdFrom, query.createdTo),
      ...this.masterFilters(query),
      ...(query.movementType === undefined ? {} : { movementType: query.movementType }),
      ...(sourceLocationId === undefined ? {} : { sourceLocationId }),
      ...(destinationLocationId === undefined ? {} : { destinationLocationId }),
      ...(createdBy === undefined ? {} : { createdBy }),
      ...(referenceId === undefined ? {} : { referenceId }),
    });
  }

  async migration(query: MigrationReportQuery = {}): Promise<MigrationReportPage> {
    const importBatchId = uuid(query.importBatchId, 'ID do lote de importação');
    const source = normalizeSearch(query.source);
    return await this.repository.migration({
      ...resolvePageRequest(query),
      ...dateRange(query.createdFrom, query.createdTo),
      ...this.masterFilters(query),
      ...(importBatchId === undefined ? {} : { importBatchId }),
      ...(source === undefined ? {} : { source }),
    });
  }

  private masterFilters(query: { readonly productId?: string; readonly categoryId?: string }): {
    productId?: string;
    categoryId?: string;
  } {
    const productId = uuid(query.productId, 'ID do produto');
    const categoryId = uuid(query.categoryId, 'ID da categoria');
    return {
      ...(productId === undefined ? {} : { productId }),
      ...(categoryId === undefined ? {} : { categoryId }),
    };
  }
}
