import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSupabaseClient,
  isRecord,
  nullableString,
  numericString,
  parsePagePayload,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import { createPaginatedResult } from '../../../types/pagination';
import type {
  ConsumptionReportItem,
  ConsumptionReportPage,
  ConsumptionReportQuery,
  CurrentStockReportItem,
  CurrentStockReportPage,
  CurrentStockReportQuery,
  EntryReportItem,
  EntryReportPage,
  EntryReportQuery,
  LossReportItem,
  LossReportPage,
  LossReportQuery,
  MigrationReportItem,
  MigrationReportPage,
  MigrationReportQuery,
  MovementReportItem,
  MovementReportPage,
  MovementReportQuery,
  ReportMovementType,
  ReportProductType,
  ReportUnit,
  ResolvedReportQuery,
  StockSituation,
} from '../domain/types';
import type { ReportRepository } from '../ports/report-repository';

const UNITS = ['UN', 'KG'] as const;
const PRODUCT_TYPES = ['RAW', 'FRACTIONATED'] as const;
const SITUATIONS = ['OUT_OF_STOCK', 'BELOW_MINIMUM', 'OK'] as const;
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

function enumString<T extends string>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
): T {
  const value = requiredString(record, key);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Campo ${key} inválido na resposta do banco.`);
  }
  return value as T;
}

function decimalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  scale: number,
): string {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    return value.toFixed(scale);
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Campo ${key} inválido na resposta do banco.`);
  }
  const [integer = '0', fraction = ''] = value.split('.');
  if (fraction.length > scale) throw new Error(`Campo ${key} inválido na resposta do banco.`);
  return `${integer}.${fraction.padEnd(scale, '0')}`;
}

function parseItem<T>(value: unknown, parser: (record: Readonly<Record<string, unknown>>) => T): T {
  if (!isRecord(value)) throw new Error('Item de relatório inválido na resposta do banco.');
  return parser(value);
}

function parseCurrentStock(record: Readonly<Record<string, unknown>>): CurrentStockReportItem {
  return {
    productId: requiredString(record, 'product_id'),
    productName: requiredString(record, 'product_name'),
    sku: requiredString(record, 'sku'),
    categoryId: nullableString(record, 'category_id'),
    categoryName: nullableString(record, 'category_name'),
    productType: enumString<ReportProductType>(record, 'product_type', PRODUCT_TYPES),
    unit: enumString<ReportUnit>(record, 'unit', UNITS),
    balance: numericString(record, 'balance'),
    minimumQuantity: numericString(record, 'minimum_quantity'),
    situation: enumString<StockSituation>(record, 'situation', SITUATIONS),
    isActive: requiredBoolean(record, 'is_active'),
  };
}

function parseConsumption(record: Readonly<Record<string, unknown>>): ConsumptionReportItem {
  return {
    productId: requiredString(record, 'product_id'),
    productName: requiredString(record, 'product_name'),
    sku: requiredString(record, 'sku'),
    categoryId: nullableString(record, 'category_id'),
    categoryName: nullableString(record, 'category_name'),
    locationId: nullableString(record, 'location_id'),
    locationName: nullableString(record, 'location_name'),
    unit: enumString<ReportUnit>(record, 'unit', UNITS),
    quantity: numericString(record, 'quantity'),
    periodStart: requiredString(record, 'period_start'),
    periodEnd: requiredString(record, 'period_end'),
  };
}

function parseLoss(record: Readonly<Record<string, unknown>>): LossReportItem {
  return {
    id: requiredString(record, 'id'),
    movementId: requiredString(record, 'movement_id'),
    productId: requiredString(record, 'product_id'),
    productName: requiredString(record, 'product_name'),
    sku: requiredString(record, 'sku'),
    categoryId: nullableString(record, 'category_id'),
    categoryName: nullableString(record, 'category_name'),
    quantity: numericString(record, 'quantity'),
    unit: enumString<ReportUnit>(record, 'unit', UNITS),
    reason: requiredString(record, 'reason'),
    notes: nullableString(record, 'notes'),
    locationId: requiredString(record, 'location_id'),
    locationName: requiredString(record, 'location_name'),
    createdBy: requiredString(record, 'created_by'),
    responsibleName: requiredString(record, 'responsible_name'),
    createdAt: requiredString(record, 'created_at'),
  };
}

function parseEntry(record: Readonly<Record<string, unknown>>): EntryReportItem {
  return {
    id: requiredString(record, 'id'),
    invoiceId: requiredString(record, 'invoice_id'),
    invoiceNumber: requiredString(record, 'invoice_number'),
    series: nullableString(record, 'series'),
    issuedAt: requiredString(record, 'issued_at'),
    supplierId: requiredString(record, 'supplier_id'),
    supplierLegalName: requiredString(record, 'supplier_legal_name'),
    supplierTradeName: nullableString(record, 'supplier_trade_name'),
    productId: requiredString(record, 'product_id'),
    productName: requiredString(record, 'product_name'),
    sku: requiredString(record, 'sku'),
    categoryId: nullableString(record, 'category_id'),
    categoryName: nullableString(record, 'category_name'),
    quantity: numericString(record, 'quantity'),
    unit: enumString<ReportUnit>(record, 'unit', UNITS),
    unitPrice: decimalString(record, 'unit_price', 4),
    totalAmount: decimalString(record, 'total_amount', 2),
  };
}

function parseMovement(record: Readonly<Record<string, unknown>>): MovementReportItem {
  return {
    id: requiredString(record, 'id'),
    productId: requiredString(record, 'product_id'),
    productName: requiredString(record, 'product_name'),
    sku: requiredString(record, 'sku'),
    movementType: enumString<ReportMovementType>(record, 'movement_type', MOVEMENT_TYPES),
    quantity: numericString(record, 'quantity'),
    unit: enumString<ReportUnit>(record, 'unit', UNITS),
    sourceLocationId: nullableString(record, 'source_location_id'),
    sourceLocationName: nullableString(record, 'source_location_name'),
    destinationLocationId: nullableString(record, 'destination_location_id'),
    destinationLocationName: nullableString(record, 'destination_location_name'),
    createdBy: requiredString(record, 'created_by'),
    responsibleName: requiredString(record, 'responsible_name'),
    createdAt: requiredString(record, 'created_at'),
    reason: nullableString(record, 'reason'),
    referenceId: nullableString(record, 'reference_id'),
    invoiceId: nullableString(record, 'invoice_id'),
    importBatchId: nullableString(record, 'import_batch_id'),
  };
}

function parseMigration(record: Readonly<Record<string, unknown>>): MigrationReportItem {
  return {
    movementId: requiredString(record, 'movement_id'),
    productId: requiredString(record, 'product_id'),
    productName: requiredString(record, 'product_name'),
    sku: requiredString(record, 'sku'),
    categoryId: nullableString(record, 'category_id'),
    categoryName: nullableString(record, 'category_name'),
    openingQuantity: numericString(record, 'opening_quantity'),
    unit: enumString<ReportUnit>(record, 'unit', UNITS),
    importBatchId: requiredString(record, 'import_batch_id'),
    sourceType: requiredString(record, 'source_type'),
    sourceName: requiredString(record, 'source_name'),
    origin: nullableString(record, 'origin'),
    createdAt: requiredString(record, 'created_at'),
  };
}

export class SupabaseReportRepository implements ReportRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async currentStock(
    query: ResolvedReportQuery<CurrentStockReportQuery>,
  ): Promise<CurrentStockReportPage> {
    return await this.page(
      'report_current_stock',
      {
        p_search: query.search ?? null,
        p_category_id: query.categoryId ?? null,
        p_product_type: query.productType ?? null,
        p_unit: query.unit ?? null,
        p_situation: query.situation ?? null,
        p_is_active: query.isActive === undefined ? true : query.isActive,
        p_page: query.page,
        p_page_size: query.pageSize,
      },
      parseCurrentStock,
    );
  }

  async consumption(
    query: ResolvedReportQuery<ConsumptionReportQuery>,
  ): Promise<ConsumptionReportPage> {
    return await this.page(
      'report_consumption',
      {
        p_created_from: query.createdFrom ?? null,
        p_created_to: query.createdTo ?? null,
        p_product_id: query.productId ?? null,
        p_category_id: query.categoryId ?? null,
        p_location_id: query.locationId ?? null,
        p_page: query.page,
        p_page_size: query.pageSize,
      },
      parseConsumption,
    );
  }

  async losses(query: ResolvedReportQuery<LossReportQuery>): Promise<LossReportPage> {
    return await this.page(
      'report_losses',
      {
        p_created_from: query.createdFrom ?? null,
        p_created_to: query.createdTo ?? null,
        p_product_id: query.productId ?? null,
        p_category_id: query.categoryId ?? null,
        p_location_id: query.locationId ?? null,
        p_created_by: query.createdBy ?? null,
        p_page: query.page,
        p_page_size: query.pageSize,
      },
      parseLoss,
    );
  }

  async entries(query: ResolvedReportQuery<EntryReportQuery>): Promise<EntryReportPage> {
    return await this.page(
      'report_entries',
      {
        p_issued_from: query.issuedFrom ?? null,
        p_issued_to: query.issuedTo ?? null,
        p_supplier_id: query.supplierId ?? null,
        p_invoice_id: query.invoiceId ?? null,
        p_product_id: query.productId ?? null,
        p_category_id: query.categoryId ?? null,
        p_page: query.page,
        p_page_size: query.pageSize,
      },
      parseEntry,
    );
  }

  async movements(query: ResolvedReportQuery<MovementReportQuery>): Promise<MovementReportPage> {
    return await this.page(
      'report_stock_movements',
      {
        p_created_from: query.createdFrom ?? null,
        p_created_to: query.createdTo ?? null,
        p_product_id: query.productId ?? null,
        p_movement_type: query.movementType ?? null,
        p_source_location_id: query.sourceLocationId ?? null,
        p_destination_location_id: query.destinationLocationId ?? null,
        p_created_by: query.createdBy ?? null,
        p_reference_id: query.referenceId ?? null,
        p_page: query.page,
        p_page_size: query.pageSize,
      },
      parseMovement,
    );
  }

  async migration(query: ResolvedReportQuery<MigrationReportQuery>): Promise<MigrationReportPage> {
    return await this.page(
      'report_migration_opening_balances',
      {
        p_created_from: query.createdFrom ?? null,
        p_created_to: query.createdTo ?? null,
        p_import_batch_id: query.importBatchId ?? null,
        p_product_id: query.productId ?? null,
        p_category_id: query.categoryId ?? null,
        p_source: query.source ?? null,
        p_page: query.page,
        p_page_size: query.pageSize,
      },
      parseMigration,
    );
  }

  private async page<T>(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>,
    parser: (record: Readonly<Record<string, unknown>>) => T,
  ) {
    const payload = parsePagePayload(
      await unwrapSupabaseResponse(this.client.rpc(functionName, parameters)),
    );
    return createPaginatedResult(
      payload.items.map((item) => parseItem(item, parser)),
      payload.total,
      payload.page,
      payload.pageSize,
    );
  }
}
