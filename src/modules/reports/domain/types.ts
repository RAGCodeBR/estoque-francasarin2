import type { PageRequest, PaginatedResult } from '../../../types/pagination';

export type ReportProductType = 'RAW' | 'FRACTIONATED';
export type ReportUnit = 'UN' | 'KG';
export type StockSituation = 'OUT_OF_STOCK' | 'BELOW_MINIMUM' | 'OK';
export type ReportMovementType =
  | 'PURCHASE_ENTRY'
  | 'CONSUMPTION_EXIT'
  | 'LOSS'
  | 'ADJUSTMENT_POSITIVE'
  | 'ADJUSTMENT_NEGATIVE'
  | 'TRANSFER'
  | 'FRACTIONATION'
  | 'MIGRATION_OPENING_BALANCE';

export interface DateRangeReportQuery extends PageRequest {
  readonly createdFrom?: string;
  readonly createdTo?: string;
}

export interface CurrentStockReportQuery extends PageRequest {
  readonly search?: string;
  readonly categoryId?: string;
  readonly productType?: ReportProductType;
  readonly unit?: ReportUnit;
  readonly situation?: StockSituation;
  readonly isActive?: boolean | null;
}

export interface CurrentStockReportItem {
  readonly productId: string;
  readonly productName: string;
  readonly sku: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly productType: ReportProductType;
  readonly unit: ReportUnit;
  readonly balance: string;
  readonly minimumQuantity: string;
  readonly situation: StockSituation;
  readonly isActive: boolean;
}

export interface ConsumptionReportQuery extends DateRangeReportQuery {
  readonly productId?: string;
  readonly categoryId?: string;
  readonly locationId?: string;
}

export interface ConsumptionReportItem {
  readonly productId: string;
  readonly productName: string;
  readonly sku: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly unit: ReportUnit;
  readonly quantity: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface LossReportQuery extends DateRangeReportQuery {
  readonly productId?: string;
  readonly categoryId?: string;
  readonly locationId?: string;
  readonly createdBy?: string;
}

export interface LossReportItem {
  readonly id: string;
  readonly movementId: string;
  readonly productId: string;
  readonly productName: string;
  readonly sku: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly quantity: string;
  readonly unit: ReportUnit;
  readonly reason: string;
  readonly notes: string | null;
  readonly locationId: string;
  readonly locationName: string;
  readonly createdBy: string;
  readonly responsibleName: string;
  readonly createdAt: string;
}

export interface EntryReportQuery extends PageRequest {
  readonly issuedFrom?: string;
  readonly issuedTo?: string;
  readonly supplierId?: string;
  readonly invoiceId?: string;
  readonly productId?: string;
  readonly categoryId?: string;
}

export interface EntryReportItem {
  readonly id: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly series: string | null;
  readonly issuedAt: string;
  readonly supplierId: string;
  readonly supplierLegalName: string;
  readonly supplierTradeName: string | null;
  readonly productId: string;
  readonly productName: string;
  readonly sku: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly quantity: string;
  readonly unit: ReportUnit;
  readonly unitPrice: string;
  readonly totalAmount: string;
}

export interface MovementReportQuery extends DateRangeReportQuery {
  readonly productId?: string;
  readonly movementType?: ReportMovementType;
  readonly sourceLocationId?: string;
  readonly destinationLocationId?: string;
  readonly createdBy?: string;
  readonly referenceId?: string;
}

export interface MovementReportItem {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly sku: string;
  readonly movementType: ReportMovementType;
  readonly quantity: string;
  readonly unit: ReportUnit;
  readonly sourceLocationId: string | null;
  readonly sourceLocationName: string | null;
  readonly destinationLocationId: string | null;
  readonly destinationLocationName: string | null;
  readonly createdBy: string;
  readonly responsibleName: string;
  readonly createdAt: string;
  readonly reason: string | null;
  readonly referenceId: string | null;
  readonly invoiceId: string | null;
  readonly importBatchId: string | null;
}

export interface MigrationReportQuery extends DateRangeReportQuery {
  readonly importBatchId?: string;
  readonly productId?: string;
  readonly categoryId?: string;
  readonly source?: string;
}

export interface MigrationReportItem {
  readonly movementId: string;
  readonly productId: string;
  readonly productName: string;
  readonly sku: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly openingQuantity: string;
  readonly unit: ReportUnit;
  readonly importBatchId: string;
  readonly sourceType: string;
  readonly sourceName: string;
  readonly origin: string | null;
  readonly createdAt: string;
}

export type CurrentStockReportPage = PaginatedResult<CurrentStockReportItem>;
export type ConsumptionReportPage = PaginatedResult<ConsumptionReportItem>;
export type LossReportPage = PaginatedResult<LossReportItem>;
export type EntryReportPage = PaginatedResult<EntryReportItem>;
export type MovementReportPage = PaginatedResult<MovementReportItem>;
export type MigrationReportPage = PaginatedResult<MigrationReportItem>;

export type ResolvedReportQuery<T extends PageRequest> = Omit<T, 'page' | 'pageSize'> & {
  readonly page: number;
  readonly pageSize: number;
};
