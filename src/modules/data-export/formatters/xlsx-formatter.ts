import { strToU8, zipSync } from 'fflate';

import type { ExportCellValue } from '../domain/types';
import { dataHeaders, dataValues, metadataRows } from './document-rows';
import type { ExportDocumentInput, SerializedExport } from './types';

function xmlText(value: string): string {
  let validXml = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    validXml +=
      code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d ? '\uFFFD' : character;
  }
  return validXml
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnName(index: number): string {
  let current = index + 1;
  let result = '';
  while (current > 0) {
    result = String.fromCharCode(65 + ((current - 1) % 26)) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function cellXml(value: ExportCellValue, row: number, column: number, style = 0): string {
  if (value === null) return '';
  const text = typeof value === 'boolean' ? String(value) : value;
  return `<c r="${columnName(column)}${String(row)}" t="inlineStr" s="${String(style)}"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

function widths(rows: readonly (readonly ExportCellValue[])[]): string {
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const length = Math.max(
      10,
      ...rows.map((row) => {
        const value = row[columnIndex];
        return value === null || value === undefined ? 0 : String(value).length + 2;
      }),
    );
    return `<col min="${String(columnIndex + 1)}" max="${String(columnIndex + 1)}" width="${String(Math.min(60, length))}" customWidth="1"/>`;
  }).join('');
}

function worksheetXml(
  rows: readonly (readonly ExportCellValue[])[],
  headerRow: number,
  autoFilter: boolean,
): string {
  const rowXml = rows
    .map((values, rowIndex) => {
      const number = rowIndex + 1;
      const cells = values
        .map((value, columnIndex) =>
          cellXml(value, number, columnIndex, number === headerRow ? 1 : 0),
        )
        .join('');
      return `<row r="${String(number)}">${cells}</row>`;
    })
    .join('');
  const lastColumn = columnName(Math.max(0, (rows[0]?.length ?? 1) - 1));
  const lastRow = Math.max(1, rows.length);
  const filter = autoFilter
    ? `<autoFilter ref="A${String(headerRow)}:${lastColumn}${String(lastRow)}"/>`
    : '';
  const frozen =
    headerRow > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${String(headerRow)}" topLeftCell="A${String(headerRow + 1)}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${frozen}<cols>${widths(rows)}</cols><sheetData>${rowXml}</sheetData>${filter}
</worksheet>`;
}

export function formatXlsx(input: ExportDocumentInput): SerializedExport {
  const dataRows: readonly (readonly ExportCellValue[])[] = [
    dataHeaders(input),
    ...input.rows.map((row) => dataValues(input, row)),
  ];
  const infoRows = metadataRows(input);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xmlText(input.definition.sheetName)}" sheetId="1" r:id="rId1"/><sheet name="Metadados" sheetId="2" r:id="rId2"/></sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6F4E37"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(worksheetXml(dataRows, 1, true)),
    'xl/worksheets/sheet2.xml': strToU8(worksheetXml(infoRows, 6, false)),
  };
  return {
    format: 'XLSX',
    bytes: zipSync(files, { level: 6 }),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  };
}
