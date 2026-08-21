import { PDF_VISUAL_EXPORT_TYPES } from '../domain/types';
import type {
  ExportCellValue,
  ExportRow,
  OperationalExportType,
  PdfVisualExportType,
} from '../domain/types';
import type { ExportDocumentInput, SerializedExport } from './types';

interface PdfColumn {
  readonly key: string;
  readonly label: string;
  readonly width: number;
}

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const ROW_HEIGHT = 16;
const ROWS_PER_PAGE = 25;

const REPORT_COLUMNS: Readonly<Record<PdfVisualExportType, readonly PdfColumn[]>> = {
  STOCK_CURRENT: [
    { key: 'sku', label: 'SKU', width: 72 },
    { key: 'name', label: 'Produto', width: 180 },
    { key: 'category', label: 'Categoria', width: 120 },
    { key: 'product_type', label: 'Tipo', width: 70 },
    { key: 'unit', label: 'Un.', width: 42 },
    { key: 'current_quantity', label: 'Saldo atual', width: 85 },
    { key: 'minimum_quantity', label: 'Mínimo', width: 70 },
    { key: 'situation', label: 'Situação', width: 99 },
  ],
  PRODUCTS_WITH_CURRENT_STOCK: [
    { key: 'sku', label: 'SKU', width: 68 },
    { key: 'ean', label: 'EAN', width: 90 },
    { key: 'name', label: 'Produto', width: 165 },
    { key: 'category', label: 'Categoria', width: 105 },
    { key: 'product_type', label: 'Tipo', width: 65 },
    { key: 'unit', label: 'Un.', width: 38 },
    { key: 'current_quantity', label: 'Saldo', width: 65 },
    { key: 'minimum_quantity', label: 'Mínimo', width: 62 },
    { key: 'active', label: 'Status', width: 80 },
  ],
  STOCK_MOVEMENTS: [
    { key: 'created_at', label: 'Data', width: 92 },
    { key: 'sku', label: 'SKU', width: 68 },
    { key: 'product_name', label: 'Produto', width: 145 },
    { key: 'movement_type', label: 'Movimento', width: 105 },
    { key: 'quantity', label: 'Quantidade', width: 72 },
    { key: 'source_location', label: 'Origem', width: 85 },
    { key: 'destination_location', label: 'Destino', width: 85 },
    { key: 'responsible', label: 'Responsável', width: 92 },
  ],
  LOSSES: [
    { key: 'created_at', label: 'Data', width: 92 },
    { key: 'sku', label: 'SKU', width: 72 },
    { key: 'product_name', label: 'Produto', width: 155 },
    { key: 'quantity', label: 'Quantidade', width: 75 },
    { key: 'location', label: 'Local', width: 105 },
    { key: 'reason', label: 'Motivo', width: 175 },
    { key: 'responsible', label: 'Responsável', width: 94 },
  ],
  INVOICES: [
    { key: 'issued_at', label: 'Emissão', width: 92 },
    { key: 'invoice_number', label: 'NF', width: 62 },
    { key: 'supplier_trade_name', label: 'Fornecedor', width: 145 },
    { key: 'sku', label: 'SKU', width: 68 },
    { key: 'product_name', label: 'Produto', width: 155 },
    { key: 'quantity', label: 'Quantidade', width: 72 },
    { key: 'unit', label: 'Un.', width: 38 },
    { key: 'total_amount', label: 'Valor total', width: 80 },
    { key: 'invoice_status', label: 'Status', width: 80 },
  ],
};

const WINDOWS_1252: Readonly<Record<string, number>> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

function windows1252(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0x3f;
    if (code <= 0xff && !(code >= 0x80 && code <= 0x9f)) bytes.push(code);
    else bytes.push(WINDOWS_1252[character] ?? 0x3f);
  }
  return Uint8Array.from(bytes);
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function escapePdfText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function humanValue(key: string, value: ExportCellValue | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Ativo' : 'Inativo';
  if (key.endsWith('_at')) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Sao_Paulo',
      });
    }
  }
  const labels: Readonly<Record<string, string>> = {
    RAW: 'Bruto',
    FRACTIONATED: 'Fracionado',
    OUT_OF_STOCK: 'Sem estoque',
    BELOW_MINIMUM: 'Abaixo do mínimo',
    OK: 'Regular',
    PURCHASE_ENTRY: 'Entrada por compra',
    CONSUMPTION_EXIT: 'Saída por consumo',
    LOSS: 'Perda',
    ADJUSTMENT_POSITIVE: 'Ajuste positivo',
    ADJUSTMENT_NEGATIVE: 'Ajuste negativo',
    TRANSFER: 'Transferência',
    FRACTIONATION: 'Fracionamento',
    MIGRATION_OPENING_BALANCE: 'Saldo inicial',
    PENDING_REVIEW: 'Revisão pendente',
    CONFIRMED: 'Confirmada',
    CANCELLED: 'Cancelada',
    DRAFT: 'Rascunho',
  };
  return labels[value] ?? value;
}

function fitText(value: string, width: number, fontSize: number): string {
  const maxCharacters = Math.max(3, Math.floor(width / (fontSize * 0.51)));
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, Math.max(1, maxCharacters - 3)).trimEnd()}...`;
}

function pdfText(
  value: string,
  x: number,
  y: number,
  size: number,
  bold = false,
  color = '0.16 0.12 0.10',
): string {
  return `BT /${bold ? 'F2' : 'F1'} ${String(size)} Tf ${color} rg 1 0 0 1 ${String(x)} ${String(y)} Tm (${escapePdfText(value)}) Tj ET\n`;
}

function pageContent(
  input: ExportDocumentInput,
  columns: readonly PdfColumn[],
  rows: readonly ExportRow[],
  pageNumber: number,
  pageCount: number,
): Uint8Array {
  const title =
    input.definition.type === 'PRODUCTS_WITH_CURRENT_STOCK'
      ? 'Cadastro completo de produtos'
      : input.definition.sheetName;
  let content = '';
  content += 'q 0.26 0.15 0.10 rg 36 529 770 36 re f Q\n';
  content += pdfText(title, 48, 545, 16, true, '1 1 1');
  content += pdfText(
    `Gerado em ${new Date(input.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    48,
    516,
    8,
    false,
    '0.38 0.33 0.30',
  );
  content += pdfText(
    `Schema ${String(1)} - ${String(input.rows.length)} registros`,
    650,
    516,
    8,
    false,
    '0.38 0.33 0.30',
  );

  const tableTop = 492;
  content += `q 0.91 0.87 0.82 rg ${String(MARGIN)} ${String(tableTop)} 770 19 re f Q\n`;
  let x = MARGIN;
  for (const column of columns) {
    content += pdfText(
      fitText(column.label, column.width - 8, 7.5),
      x + 4,
      tableTop + 6,
      7.5,
      true,
    );
    x += column.width;
  }

  rows.forEach((row, index) => {
    const y = tableTop - (index + 1) * ROW_HEIGHT;
    if (index % 2 === 1) {
      content += `q 0.98 0.97 0.95 rg ${String(MARGIN)} ${String(y)} 770 ${String(ROW_HEIGHT)} re f Q\n`;
    }
    content += `q 0.88 0.85 0.82 RG 0.35 w ${String(MARGIN)} ${String(y)} m 806 ${String(y)} l S Q\n`;
    let cellX = MARGIN;
    for (const column of columns) {
      const label = fitText(humanValue(column.key, row[column.key]), column.width - 8, 7.2);
      content += pdfText(label, cellX + 4, y + 5, 7.2);
      cellX += column.width;
    }
  });

  content += pdfText(
    'Estoque Fran - exportação administrativa auditada',
    MARGIN,
    25,
    7.5,
    false,
    '0.45 0.40 0.37',
  );
  content += pdfText(
    `Página ${String(pageNumber)} de ${String(pageCount)}`,
    735,
    25,
    7.5,
    false,
    '0.45 0.40 0.37',
  );
  return windows1252(content);
}

function pdfObject(id: number, payload: Uint8Array): Uint8Array {
  return concatBytes([ascii(`${String(id)} 0 obj\n`), payload, ascii('\nendobj\n')]);
}

function buildPdf(contents: readonly Uint8Array[]): Uint8Array {
  const pageIds = contents.map((_, index) => 5 + index * 2);
  const objects = new Map<number, Uint8Array>();
  objects.set(1, ascii('<< /Type /Catalog /Pages 2 0 R >>'));
  objects.set(
    2,
    ascii(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pageIds.length)} >>`,
    ),
  );
  objects.set(
    3,
    ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  );
  objects.set(
    4,
    ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
  );
  contents.forEach((content, index) => {
    const pageId = pageIds[index];
    if (pageId === undefined) throw new Error('Página PDF inválida.');
    const contentId = pageId + 1;
    objects.set(
      pageId,
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${String(contentId)} 0 R >>`,
      ),
    );
    objects.set(
      contentId,
      concatBytes([
        ascii(`<< /Length ${String(content.byteLength)} >>\nstream\n`),
        content,
        ascii('\nendstream'),
      ]),
    );
  });

  const maxId = Math.max(...objects.keys());
  const chunks: Uint8Array[] = [
    concatBytes([ascii('%PDF-1.4\n%'), Uint8Array.from([0xe2, 0xe3, 0xcf, 0xd3]), ascii('\n')]),
  ];
  const offsets = Array.from({ length: maxId + 1 }, () => 0);
  let offset = chunks[0]?.byteLength ?? 0;
  for (let id = 1; id <= maxId; id += 1) {
    const payload = objects.get(id);
    if (!payload) throw new Error(`Objeto PDF ${String(id)} ausente.`);
    offsets[id] = offset;
    const object = pdfObject(id, payload);
    chunks.push(object);
    offset += object.byteLength;
  }
  const xrefOffset = offset;
  let xref = `xref\n0 ${String(maxId + 1)}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    xref += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${String(maxId + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  chunks.push(ascii(xref));
  return concatBytes(chunks);
}

function reportColumns(type: OperationalExportType): readonly PdfColumn[] {
  if (!PDF_VISUAL_EXPORT_TYPES.includes(type as PdfVisualExportType)) {
    throw new Error('PDF está disponível somente para relatórios visuais.');
  }
  return REPORT_COLUMNS[type as PdfVisualExportType];
}

export function formatPdf(input: ExportDocumentInput): SerializedExport {
  const columns = reportColumns(input.definition.type);
  const pageCount = Math.max(1, Math.ceil(input.rows.length / ROWS_PER_PAGE));
  const contents = Array.from({ length: pageCount }, (_, pageIndex) =>
    pageContent(
      input,
      columns,
      input.rows.slice(pageIndex * ROWS_PER_PAGE, (pageIndex + 1) * ROWS_PER_PAGE),
      pageIndex + 1,
      pageCount,
    ),
  );
  return {
    format: 'PDF',
    bytes: buildPdf(contents),
    mimeType: 'application/pdf',
    extension: 'pdf',
  };
}
