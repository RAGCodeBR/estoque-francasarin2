import { strToU8, zipSync } from 'fflate';

import type {
  OperationalImportTemplate,
  OperationalImportType,
  OperationalTemplateFormat,
} from '../domain/operational-types';
import { OPERATIONAL_TEMPLATE_DEFINITIONS } from './operational-template-definitions';

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnName(index: number): string {
  let number = index;
  let name = '';
  while (number > 0) {
    name = String.fromCharCode(65 + ((number - 1) % 26)) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

function cells(values: readonly string[], row: number, style: number): string {
  return values
    .map(
      (value, index) =>
        `<c r="${columnName(index + 1)}${String(row)}" t="inlineStr" s="${String(style)}"><is><t>${xml(value)}</t></is></c>`,
    )
    .join('');
}

function xlsx(importType: OperationalImportType): Uint8Array {
  const definition = OPERATIONAL_TEMPLATE_DEFINITIONS[importType];
  const lastColumn = columnName(definition.headers.length);
  const validations = definition.validations.length
    ? `<dataValidations count="${String(definition.validations.length)}">${definition.validations
        .map(
          ({ column, values }) =>
            `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${columnName(column)}2:${columnName(column)}10001"><formula1>"${xml(values.join(','))}"</formula1></dataValidation>`,
        )
        .join('')}</dataValidations>`
    : '';
  const instructionRows = [
    ['MODELO OFICIAL DE IMPORTAÇÃO OPERACIONAL'],
    [`Tipo: ${importType}`],
    ['Versão do modelo: 1'],
    [''],
    ...definition.instructions.map((instruction) => [instruction]),
  ];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(definition.sheetName)}" sheetId="1" r:id="rId1"/><sheet name="Instruções" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6F4E37"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${definition.headers.map((header, index) => `<col min="${String(index + 1)}" max="${String(index + 1)}" width="${String(Math.max(14, Math.min(32, header.length + 4)))}" customWidth="1"/>`).join('')}</cols><sheetData><row r="1">${cells(definition.headers, 1, 1)}</row></sheetData><autoFilter ref="A1:${lastColumn}1"/>${validations}</worksheet>`,
    ),
    'xl/worksheets/sheet2.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="100" customWidth="1"/></cols><sheetData>${instructionRows.map((row, index) => `<row r="${String(index + 1)}">${cells(row, index + 1, index === 0 ? 1 : 0)}</row>`).join('')}</sheetData></worksheet>`,
    ),
  };
  return zipSync(files, { level: 6 });
}

export function createOperationalImportTemplate(
  importType: OperationalImportType,
  format: OperationalTemplateFormat,
): OperationalImportTemplate {
  const definition = OPERATIONAL_TEMPLATE_DEFINITIONS[importType];
  const slug = importType.toLocaleLowerCase('en-US');
  if (format === 'CSV') {
    const content = `\uFEFF${definition.headers.join(';')}\r\n`;
    return {
      importType,
      format,
      filename: `modelo_importacao_${slug}_v1.csv`,
      mimeType: 'text/csv;charset=utf-8',
      bytes: new TextEncoder().encode(content),
    };
  }
  return {
    importType,
    format,
    filename: `modelo_importacao_${slug}_v1.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    worksheetName: definition.sheetName,
    bytes: xlsx(importType),
  };
}
