import { strToU8, zipSync } from 'fflate';

import type { ImportFile } from '../../src/modules/data-import';

export interface FormulaCell {
  formula: string;
  result?: string | number;
}

export type TestCell = string | number | null | FormulaCell;

export function createImportFile(
  name: string,
  bytes: Uint8Array,
  type = 'application/octet-stream',
): ImportFile {
  return {
    name,
    size: bytes.byteLength,
    type,
    arrayBuffer() {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return Promise.resolve(copy.buffer);
    },
  };
}

export function createCsvFile(content: string, name = 'produtos.csv'): ImportFile {
  return createImportFile(name, new TextEncoder().encode(content), 'text/csv');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnName(index: number): string {
  let current = index + 1;
  let name = '';

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
}

function cellXml(cell: TestCell, rowNumber: number, columnIndex: number): string {
  if (cell === null) return '';
  const reference = `${columnName(columnIndex)}${String(rowNumber)}`;

  if (typeof cell === 'object') {
    const result = cell.result ?? 0;
    return `<c r="${reference}"><f>${escapeXml(cell.formula)}</f><v>${escapeXml(String(result))}</v></c>`;
  }

  if (typeof cell === 'number') {
    return `<c r="${reference}" t="n"><v>${String(cell)}</v></c>`;
  }

  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
}

function worksheetXml(rows: readonly (readonly TestCell[])[]): string {
  const content = rows
    .map(
      (row, rowIndex) =>
        `<row r="${String(rowIndex + 1)}">${row
          .map((cell, columnIndex) => cellXml(cell, rowIndex + 1, columnIndex))
          .join('')}</row>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${content}</sheetData>
</worksheet>`;
}

export function createXlsxFile(
  worksheets: Readonly<Record<string, readonly (readonly TestCell[])[]>>,
  name = 'produtos.xlsx',
): ImportFile {
  const sheetEntries = Object.entries(worksheets);
  const workbookSheets = sheetEntries
    .map(
      ([sheetName], index) =>
        `<sheet name="${escapeXml(sheetName)}" sheetId="${String(index + 1)}" r:id="rId${String(index + 1)}"/>`,
    )
    .join('');
  const relationships = sheetEntries
    .map(
      (_, index) =>
        `<Relationship Id="rId${String(index + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(index + 1)}.xml"/>`,
    )
    .join('');
  const overrides = sheetEntries
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${String(index + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        ${overrides}
      </Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>${workbookSheets}</sheets>
      </workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        ${relationships}
      </Relationships>`),
  };

  sheetEntries.forEach(([, rows], index) => {
    files[`xl/worksheets/sheet${String(index + 1)}.xml`] = strToU8(worksheetXml(rows));
  });

  return createImportFile(
    name,
    zipSync(files, { level: 6 }),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}
