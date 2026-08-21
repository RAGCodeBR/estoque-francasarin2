import { assertUuid, normalizeRequiredText, normalizeSearch } from '../../../utils/domain-values';
import { resolveExportLimits } from '../config/export-limits';
import { getExportDefinition } from '../domain/export-definitions';
import { validateExportRow } from '../domain/row-validation';
import {
  EXPORT_SCHEMA_VERSION,
  OPERATIONAL_EXPORT_TYPES,
  type ExportLimits,
  type ExportRow,
  type OperationalExportArtifact,
  type OperationalExportFilters,
  type OperationalExportFormat,
  type OperationalExportRequest,
  type OperationalExportType,
} from '../domain/types';
import { serializeExport } from '../formatters/serialize-export';
import type { OperationalExportRepository } from '../ports/export-repository';

const EXPORT_FORMATS = ['CSV', 'XLSX', 'JSON'] as const;
const PRODUCT_TYPES = ['RAW', 'FRACTIONATED'] as const;
const UNITS = ['UN', 'KG'] as const;
const LOCATION_TYPES = ['STOCK', 'CONSUMPTION'] as const;
const MOVEMENT_TYPES = [
  'PURCHASE_ENTRY',
  'CONSUMPTION_EXIT',
  'LOSS',
  'ADJUSTMENT_POSITIVE',
  'ADJUSTMENT_NEGATIVE',
  'TRANSFER',
  'FRACTIONATION',
  'MIGRATION_OPENING_BALANCE',
] as const;
const INVOICE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'CONFIRMED', 'CANCELLED'] as const;

export interface OperationalExportServiceOptions {
  readonly limits?: Partial<ExportLimits>;
  readonly now?: () => Date;
}

function assertExportType(value: unknown): OperationalExportType {
  if (
    typeof value !== 'string' ||
    !OPERATIONAL_EXPORT_TYPES.includes(value as OperationalExportType)
  ) {
    throw new Error('Tipo de exportação não suportado.');
  }
  return value as OperationalExportType;
}

function assertFormat(value: unknown): OperationalExportFormat {
  if (typeof value !== 'string' || !EXPORT_FORMATS.includes(value as OperationalExportFormat)) {
    throw new Error('Formato de exportação não suportado.');
  }
  return value as OperationalExportFormat;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${field} inválido para exportação.`);
  }
  return value as T;
}

function timestamp(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} inválida para exportação.`);
  const normalized = value.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${field} deve conter data, hora e fuso explícitos.`);
  }
  return new Date(normalized).toISOString();
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} deve ser um UUID válido.`);
  return assertUuid(value, field);
}

function normalizeFilters(
  type: OperationalExportType,
  input: OperationalExportFilters | undefined,
): OperationalExportFilters {
  const filters = input ?? {};
  const definition = getExportDefinition(type);
  for (const key of Object.keys(filters)) {
    if (!definition.allowedFilters.includes(key as keyof OperationalExportFilters)) {
      throw new Error(`Filtro ${key} não é permitido para ${type}.`);
    }
  }
  if (filters.isActive !== undefined && typeof filters.isActive !== 'boolean') {
    throw new Error('Estado ativo deve ser booleano.');
  }
  const createdFrom = timestamp(filters.createdFrom, 'Data inicial');
  const createdTo = timestamp(filters.createdTo, 'Data final');
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new Error('Data inicial não pode ser posterior à data final.');
  }
  const search = normalizeSearch(filters.search);
  const categoryId = optionalUuid(filters.categoryId, 'ID da categoria');
  const productId = optionalUuid(filters.productId, 'ID do produto');
  const supplierId = optionalUuid(filters.supplierId, 'ID do fornecedor');
  const locationId = optionalUuid(filters.locationId, 'ID do local');
  const productType = enumValue(filters.productType, PRODUCT_TYPES, 'Tipo de produto');
  const unit = enumValue(filters.unit, UNITS, 'Unidade');
  const locationType = enumValue(filters.locationType, LOCATION_TYPES, 'Tipo de local');
  const movementType = enumValue(filters.movementType, MOVEMENT_TYPES, 'Tipo de movimento');
  const invoiceStatus = enumValue(filters.invoiceStatus, INVOICE_STATUSES, 'Status da nota');
  return {
    ...(search === undefined ? {} : { search }),
    ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(productId === undefined ? {} : { productId }),
    ...(supplierId === undefined ? {} : { supplierId }),
    ...(locationId === undefined ? {} : { locationId }),
    ...(productType === undefined ? {} : { productType }),
    ...(unit === undefined ? {} : { unit }),
    ...(locationType === undefined ? {} : { locationType }),
    ...(movementType === undefined ? {} : { movementType }),
    ...(invoiceStatus === undefined ? {} : { invoiceStatus }),
    ...(createdFrom === undefined ? {} : { createdFrom }),
    ...(createdTo === undefined ? {} : { createdTo }),
  };
}

function normalizeSelectedIds(
  values: readonly string[] | undefined,
  limits: ExportLimits,
): readonly string[] | null {
  if (values === undefined) return null;
  if (values.length > limits.maxSelectedIds) {
    throw new Error(`Seleção não pode exceder ${String(limits.maxSelectedIds)} registros.`);
  }
  const unique = new Set(values.map((value) => assertUuid(value, 'ID selecionado')));
  return [...unique];
}

function timestampForFile(value: string): string {
  return value.replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export class OperationalExportService {
  private readonly limits: ExportLimits;
  private readonly now: () => Date;

  constructor(
    private readonly repository: OperationalExportRepository,
    options: OperationalExportServiceOptions = {},
  ) {
    this.limits = resolveExportLimits(options.limits);
    this.now = options.now ?? (() => new Date());
  }

  async export(request: OperationalExportRequest): Promise<OperationalExportArtifact> {
    const type = assertExportType(request.type);
    const format = assertFormat(request.format);
    const definition = getExportDefinition(type);
    const filters = normalizeFilters(type, request.filters);
    const selectedIds = normalizeSelectedIds(request.selectedIds, this.limits);
    const idempotencyKey = normalizeRequiredText(request.idempotencyKey, 'Chave de idempotência');
    if (idempotencyKey.length > 200) {
      throw new Error('Chave de idempotência deve possuir no máximo 200 caracteres.');
    }

    const rows: ExportRow[] = [];
    let expectedTotal: number | null = null;
    let pageNumber = 1;
    do {
      const page = await this.repository.fetchPage({
        type,
        filters,
        selectedIds,
        page: pageNumber,
        pageSize: this.limits.pageSize,
      });
      if (page.schemaVersion !== EXPORT_SCHEMA_VERSION || page.exportType !== type) {
        throw new Error('Schema incompatível na resposta da exportação.');
      }
      if (page.page !== pageNumber || page.pageSize !== this.limits.pageSize) {
        throw new Error('Paginação inconsistente na resposta da exportação.');
      }
      if (expectedTotal === null) {
        expectedTotal = page.total;
        if (expectedTotal > this.limits.maxRows) {
          throw new Error(
            `Exportação excede o limite de ${String(this.limits.maxRows)} registros.`,
          );
        }
      } else if (page.total !== expectedTotal) {
        throw new Error('Os dados mudaram durante a exportação; execute novamente.');
      }
      if (page.rows.length === 0 && rows.length < expectedTotal) {
        throw new Error('Página vazia inesperada durante a exportação.');
      }
      for (const row of page.rows) {
        validateExportRow(row, definition, this.limits);
        rows.push(row);
      }
      if (rows.length > expectedTotal)
        throw new Error('Quantidade inconsistente de linhas exportadas.');
      pageNumber += 1;
    } while (rows.length < expectedTotal);

    const generatedAt = this.now().toISOString();
    const serialized = serializeExport(format, { definition, rows, generatedAt });
    if (serialized.bytes.byteLength > this.limits.maxOutputBytes) {
      throw new Error('Arquivo exportado excede o limite de tamanho configurado.');
    }
    const audit = await this.repository.recordCompletion({
      exportType: type,
      format,
      rowCount: rows.length,
      idempotencyKey,
    });
    return {
      fileName: `estoque-${definition.fileSlug}-${timestampForFile(generatedAt)}.${serialized.extension}`,
      mimeType: serialized.mimeType,
      bytes: serialized.bytes,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      type,
      format,
      rowCount: rows.length,
      generatedAt,
      audit,
    };
  }
}
