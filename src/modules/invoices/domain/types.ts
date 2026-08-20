export type InvoiceImportStatus =
  'UPLOADED' | 'PENDING_REVIEW' | 'READY' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';

export interface NfeItem {
  readonly lineNumber: number;
  readonly supplierProductCode: string | null;
  readonly description: string;
  readonly ean: string | null;
  readonly unit: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly totalAmount: string;
}

export interface ParsedNfe {
  readonly accessKey: string | null;
  readonly invoiceNumber: string;
  readonly series: string | null;
  readonly issuedAt: string;
  readonly supplier: {
    readonly document: string;
    readonly legalName: string;
    readonly tradeName: string | null;
  };
  readonly items: readonly NfeItem[];
}

export interface NfeXmlFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ParsedNfeFile {
  readonly fileHash: string;
  readonly originalFilename: string;
  readonly invoice: ParsedNfe;
}

export interface NfeItemResolution {
  readonly itemId: string;
  readonly productId: string;
  readonly unit: 'UN' | 'KG';
  readonly createSupplierMapping?: boolean;
}

export interface NfeConfirmationReport {
  readonly invoiceId: string;
  readonly itemsCreated: number;
  readonly movementsCreated: number;
  readonly supplierMappingsCreated: number;
  readonly applied: boolean;
}
