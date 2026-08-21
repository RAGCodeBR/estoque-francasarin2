export const EXPORT_SCHEMA_VERSION = 1 as const;

export const OPERATIONAL_EXPORT_TYPES = [
  'PRODUCTS',
  'CATEGORIES',
  'LOCATIONS',
  'SUPPLIERS',
  'STOCK_CURRENT',
  'STOCK_MOVEMENTS',
  'LOSSES',
  'INVOICES',
  'PRODUCTS_WITH_CURRENT_STOCK',
] as const;

export const PDF_VISUAL_EXPORT_TYPES = [
  'STOCK_CURRENT',
  'STOCK_MOVEMENTS',
  'LOSSES',
  'INVOICES',
  'PRODUCTS_WITH_CURRENT_STOCK',
] as const;

export type OperationalExportType = (typeof OPERATIONAL_EXPORT_TYPES)[number];
export type PdfVisualExportType = (typeof PDF_VISUAL_EXPORT_TYPES)[number];
export type OperationalExportFormat = 'CSV' | 'XLSX' | 'JSON' | 'PDF';
export type ExportCellValue = string | boolean | null;
export type ExportRow = Readonly<Record<string, ExportCellValue>>;
export type ExportColumnType = 'UUID' | 'TEXT' | 'BOOLEAN' | 'DECIMAL' | 'DATETIME';

export interface ExportColumn {
  readonly key: string;
  readonly label: string;
  readonly type: ExportColumnType;
}

export interface ExportDefinition {
  readonly type: OperationalExportType;
  readonly fileSlug: string;
  readonly sheetName: string;
  readonly columns: readonly ExportColumn[];
  readonly allowedFilters: readonly (keyof OperationalExportFilters)[];
}

export interface OperationalExportFilters {
  readonly search?: string;
  readonly isActive?: boolean;
  readonly categoryId?: string;
  readonly productId?: string;
  readonly supplierId?: string;
  readonly locationId?: string;
  readonly productType?: 'RAW' | 'FRACTIONATED';
  readonly unit?: 'UN' | 'KG';
  readonly locationType?: 'STOCK' | 'CONSUMPTION';
  readonly movementType?:
    | 'PURCHASE_ENTRY'
    | 'CONSUMPTION_EXIT'
    | 'LOSS'
    | 'ADJUSTMENT_POSITIVE'
    | 'ADJUSTMENT_NEGATIVE'
    | 'TRANSFER'
    | 'FRACTIONATION'
    | 'MIGRATION_OPENING_BALANCE';
  readonly invoiceStatus?: 'DRAFT' | 'PENDING_REVIEW' | 'CONFIRMED' | 'CANCELLED';
  readonly createdFrom?: string;
  readonly createdTo?: string;
}

export interface OperationalExportRequest {
  readonly type: OperationalExportType;
  readonly format: OperationalExportFormat;
  readonly filters?: OperationalExportFilters;
  readonly selectedIds?: readonly string[];
  readonly idempotencyKey: string;
}

export interface OperationalExportEstimateRequest {
  readonly type: OperationalExportType;
  readonly filters?: OperationalExportFilters;
  readonly selectedIds?: readonly string[];
}

export interface ExportPageRequest {
  readonly type: OperationalExportType;
  readonly filters: OperationalExportFilters;
  readonly selectedIds: readonly string[] | null;
  readonly page: number;
  readonly pageSize: number;
}

export interface ExportDataPage {
  readonly schemaVersion: number;
  readonly exportType: OperationalExportType;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly rows: readonly ExportRow[];
}

export interface ExportAuditInput {
  readonly exportType: OperationalExportType;
  readonly format: OperationalExportFormat;
  readonly rowCount: number;
  readonly idempotencyKey: string;
}

export interface ExportAuditReceipt {
  readonly auditLogId: string;
  readonly exportId: string;
  readonly createdAt: string;
  readonly applied: boolean;
}

export interface OperationalExportArtifact {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  readonly type: OperationalExportType;
  readonly format: OperationalExportFormat;
  readonly rowCount: number;
  readonly generatedAt: string;
  readonly audit: ExportAuditReceipt;
}

export interface ExportLimits {
  readonly pageSize: number;
  readonly maxRows: number;
  readonly maxSelectedIds: number;
  readonly maxCellLength: number;
  readonly maxOutputBytes: number;
}
