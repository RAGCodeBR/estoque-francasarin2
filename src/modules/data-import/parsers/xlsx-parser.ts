import { XMLParser } from 'fast-xml-parser';
import { unzipSync } from 'fflate';

import { ImportFileError } from '../domain/errors';
import type {
  ImportLimits,
  ParsedImportRow,
  ParsedTable,
  XlsxParserOptions,
} from '../domain/types';
import { looksLikeFormula, validateHeaders } from './header-validation';

type UnknownRecord = Record<string, unknown>;

interface XlsxEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

interface WorksheetDescriptor {
  name: string;
  path: string;
}

export interface XlsxWorksheetInfo {
  name: string;
  position: number;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined ? [] : [value];
}

function getString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimumOffset = Math.max(0, bytes.length - 65_557);

  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }

  throw new ImportFileError('INVALID_XLSX', 'O arquivo não contém um diretório ZIP XLSX válido.');
}

function inspectXlsxContainer(bytes: Uint8Array, limits: ImportLimits): readonly XlsxEntryInfo[] {
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    (bytes[2] !== 0x03 && bytes[2] !== 0x05 && bytes[2] !== 0x07) ||
    (bytes[3] !== 0x04 && bytes[3] !== 0x06 && bytes[3] !== 0x08)
  ) {
    throw new ImportFileError('INVALID_XLSX', 'A assinatura ZIP do arquivo XLSX é inválida.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralDirectorySize = view.getUint32(endOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0xffff ||
    centralDirectoryOffset === 0xffffffff ||
    centralDirectorySize === 0xffffffff
  ) {
    throw new ImportFileError(
      'UNSAFE_XLSX_CONTAINER',
      'Arquivos ZIP multipartes ou ZIP64 não são aceitos.',
    );
  }

  if (totalEntries > limits.maxXlsxEntries) {
    throw new ImportFileError('LIMIT_EXCEEDED', 'O XLSX excede o limite de arquivos internos.', {
      maxXlsxEntries: limits.maxXlsxEntries,
    });
  }

  if (centralDirectoryOffset + centralDirectorySize > bytes.length) {
    throw new ImportFileError('INVALID_XLSX', 'O diretório central do XLSX está truncado.');
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const names = new Set<string>();
  const entries: XlsxEntryInfo[] = [];
  let totalUncompressed = 0;
  let offset = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < totalEntries; entryIndex += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new ImportFileError('INVALID_XLSX', 'Entrada inválida no diretório central do XLSX.');
    }

    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;

    if (nextOffset > bytes.length) {
      throw new ImportFileError('INVALID_XLSX', 'Entrada truncada no diretório central do XLSX.');
    }

    if ((flags & 0x0001) !== 0) {
      throw new ImportFileError(
        'UNSAFE_XLSX_CONTAINER',
        'Arquivos XLSX criptografados não são aceitos.',
      );
    }

    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new ImportFileError(
        'UNSAFE_XLSX_CONTAINER',
        'O XLSX usa um método de compactação não permitido.',
        { compressionMethod },
      );
    }

    let name: string;
    try {
      name = decoder
        .decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
        .replaceAll('\\', '/');
    } catch {
      throw new ImportFileError('INVALID_XLSX', 'Nome de arquivo interno com encoding inválido.');
    }

    if (
      name === '' ||
      name.startsWith('/') ||
      /^[a-z]:/i.test(name) ||
      name.split('/').includes('..') ||
      names.has(name)
    ) {
      throw new ImportFileError('UNSAFE_XLSX_CONTAINER', 'Caminho interno inseguro ou duplicado.', {
        entryName: name,
      });
    }

    if (uncompressedSize > limits.maxXlsxEntryBytes) {
      throw new ImportFileError(
        'LIMIT_EXCEEDED',
        'Uma entrada do XLSX excede o limite permitido.',
        {
          entryName: name,
          maxXlsxEntryBytes: limits.maxXlsxEntryBytes,
        },
      );
    }

    const lowerName = name.toLocaleLowerCase('en-US');
    if (
      lowerName === 'xl/vbaproject.bin' ||
      lowerName.startsWith('xl/activex/') ||
      lowerName.startsWith('xl/embeddings/') ||
      lowerName.startsWith('xl/externallinks/') ||
      lowerName === 'xl/connections.xml'
    ) {
      throw new ImportFileError(
        'UNSAFE_XLSX_CONTAINER',
        'Conteúdo ativo, incorporado ou externo não é aceito em arquivos XLSX.',
        { entryName: name },
      );
    }

    const compressionRatio = uncompressedSize / Math.max(1, compressedSize);
    if (compressionRatio > limits.maxXlsxCompressionRatio) {
      throw new ImportFileError(
        'UNSAFE_XLSX_CONTAINER',
        'Taxa de compressão suspeita detectada no XLSX.',
        { entryName: name, compressionRatio },
      );
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxXlsxUncompressedBytes) {
      throw new ImportFileError('LIMIT_EXCEEDED', 'O conteúdo expandido do XLSX excede o limite.', {
        maxXlsxUncompressedBytes: limits.maxXlsxUncompressedBytes,
      });
    }

    names.add(name);
    entries.push({ name, compressedSize, uncompressedSize });
    offset = nextOffset;
  }

  return entries;
}

function decodeXml(entries: Readonly<Record<string, Uint8Array>>, path: string): string {
  const bytes = entries[path];
  if (!bytes) {
    throw new ImportFileError('INVALID_XLSX', `Entrada obrigatória ausente no XLSX: ${path}`);
  }

  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ImportFileError('INVALID_XLSX', `XML com encoding inválido: ${path}`);
  }

  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new ImportFileError('UNSAFE_XLSX_CONTAINER', 'DOCTYPE e entidades XML não são aceitos.', {
      entryName: path,
    });
  }

  return xml;
}

function parseXml(xml: string, path: string): UnknownRecord {
  try {
    const parsed = xmlParser.parse(xml) as unknown;
    const record = asRecord(parsed);

    if (!record) {
      throw new Error('XML root is not an object');
    }

    return record;
  } catch (error) {
    throw new ImportFileError('INVALID_XLSX', `XML inválido no XLSX: ${path}`, {
      cause: error instanceof Error ? error.message : 'unknown',
    });
  }
}

function resolveWorksheetPath(target: string): string {
  const normalized = target.replaceAll('\\', '/');
  const path = normalized.startsWith('/') ? normalized.slice(1) : `xl/${normalized}`;
  const segments = path.split('/').filter((segment) => segment !== '.');

  if (segments.includes('..')) {
    throw new ImportFileError('UNSAFE_XLSX_CONTAINER', 'Relacionamento de planilha inseguro.');
  }

  return segments.join('/');
}

function readWorksheetDescriptors(
  entries: Readonly<Record<string, Uint8Array>>,
): readonly WorksheetDescriptor[] {
  const workbook = parseXml(decodeXml(entries, 'xl/workbook.xml'), 'xl/workbook.xml');
  const relationships = parseXml(
    decodeXml(entries, 'xl/_rels/workbook.xml.rels'),
    'xl/_rels/workbook.xml.rels',
  );
  const workbookRoot = asRecord(workbook.workbook);
  const sheetsRoot = asRecord(workbookRoot?.sheets);
  const relationshipsRoot = asRecord(relationships.Relationships);

  if (!sheetsRoot || !relationshipsRoot) {
    throw new ImportFileError('INVALID_XLSX', 'Metadados de planilhas ausentes no XLSX.');
  }

  const targets = new Map<string, string>();
  for (const relationshipValue of asArray(relationshipsRoot.Relationship)) {
    const relationship = asRecord(relationshipValue);
    if (!relationship) continue;
    const id = getString(relationship, '@_Id');
    const target = getString(relationship, '@_Target');
    if (id && target) targets.set(id, resolveWorksheetPath(target));
  }

  return asArray(sheetsRoot.sheet).map((sheetValue) => {
    const sheet = asRecord(sheetValue);
    const name = sheet ? getString(sheet, '@_name') : null;
    const relationshipId = sheet ? getString(sheet, '@_id') : null;
    const path = relationshipId ? targets.get(relationshipId) : undefined;

    if (!name || !path) {
      throw new ImportFileError('INVALID_XLSX', 'Planilha sem nome ou relacionamento válido.');
    }

    return { name, path };
  });
}

function flattenRichText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  const record = asRecord(value);
  if (!record) return '';

  const textNode = record['#text'];
  if (typeof textNode === 'string' || typeof textNode === 'number') {
    return String(textNode);
  }

  const directText = record.t;
  if (typeof directText === 'string' || typeof directText === 'number') {
    return String(directText);
  }
  if (directText !== undefined) {
    return flattenRichText(directText);
  }

  return asArray(record.r)
    .map((run) => flattenRichText(run))
    .join('');
}

function readSharedStrings(entries: Readonly<Record<string, Uint8Array>>): readonly string[] {
  if (!entries['xl/sharedStrings.xml']) {
    return [];
  }

  const document = parseXml(decodeXml(entries, 'xl/sharedStrings.xml'), 'xl/sharedStrings.xml');
  const root = asRecord(document.sst);

  if (!root) {
    throw new ImportFileError('INVALID_XLSX', 'Tabela de strings compartilhadas inválida.');
  }

  return asArray(root.si).map((value) => flattenRichText(value));
}

function columnIndexFromReference(reference: string): number {
  const match = /^([A-Z]+)\d+$/i.exec(reference);
  if (!match?.[1]) return -1;

  let index = 0;
  for (const character of match[1].toUpperCase()) {
    index = index * 26 + character.charCodeAt(0) - 64;
  }
  return index - 1;
}

function readCellValue(cell: UnknownRecord, sharedStrings: readonly string[]): string | null {
  if (Object.hasOwn(cell, 'f')) {
    throw new ImportFileError(
      'FORMULA_NOT_ALLOWED',
      `Fórmula não permitida na célula ${getString(cell, '@_r') ?? 'desconhecida'}.`,
      { cell: getString(cell, '@_r') },
    );
  }

  const type = getString(cell, '@_t') ?? 'n';

  if (type === 'inlineStr') {
    return flattenRichText(cell.is) || null;
  }

  const rawValue = getString(cell, 'v');
  if (rawValue === null || rawValue === '') return null;

  if (type === 's') {
    const sharedIndex = Number(rawValue);
    if (!Number.isSafeInteger(sharedIndex) || sharedIndex < 0 || !sharedStrings[sharedIndex]) {
      throw new ImportFileError('INVALID_XLSX', 'Índice de string compartilhada inválido.');
    }
    return sharedStrings[sharedIndex] ?? null;
  }

  if (type === 'b') return rawValue === '1' ? 'TRUE' : 'FALSE';
  if (type === 'e') {
    throw new ImportFileError('INVALID_XLSX', 'Célula com erro do Excel não pode ser importada.', {
      cell: getString(cell, '@_r'),
      excelError: rawValue,
    });
  }

  if (['n', 'str', 'd'].includes(type)) return rawValue;

  throw new ImportFileError('INVALID_XLSX', `Tipo de célula XLSX não suportado: ${type}`);
}

function readWorksheetRows(
  entries: Readonly<Record<string, Uint8Array>>,
  worksheet: WorksheetDescriptor,
  sharedStrings: readonly string[],
  limits: ImportLimits,
): readonly { rowNumber: number; cells: readonly (string | null)[] }[] {
  const document = parseXml(decodeXml(entries, worksheet.path), worksheet.path);
  const root = asRecord(document.worksheet);
  const sheetData = asRecord(root?.sheetData);
  if (!sheetData) return [];

  return asArray(sheetData.row).map((rowValue, rowIndex) => {
    const row = asRecord(rowValue);
    if (!row) {
      throw new ImportFileError('INVALID_XLSX', 'Linha inválida na planilha.');
    }

    const declaredRow = Number(getString(row, '@_r'));
    const rowNumber =
      Number.isSafeInteger(declaredRow) && declaredRow > 0 ? declaredRow : rowIndex + 1;
    const cells: (string | null)[] = [];

    asArray(row.c).forEach((cellValue, cellIndex) => {
      const cell = asRecord(cellValue);
      if (!cell) return;
      const reference = getString(cell, '@_r');
      const columnIndex = reference ? columnIndexFromReference(reference) : cellIndex;

      if (columnIndex < 0 || columnIndex >= limits.maxColumns) {
        throw new ImportFileError('LIMIT_EXCEEDED', 'O XLSX excede o limite de colunas.', {
          rowNumber,
          maxColumns: limits.maxColumns,
        });
      }

      if (cells[columnIndex] !== undefined) {
        throw new ImportFileError('INVALID_XLSX', 'Célula duplicada na mesma linha.', {
          rowNumber,
          columnIndex: columnIndex + 1,
        });
      }

      const value = readCellValue(cell, sharedStrings);
      if (value && looksLikeFormula(value)) {
        throw new ImportFileError(
          'FORMULA_NOT_ALLOWED',
          `Texto semelhante a fórmula não permitido na célula ${reference ?? 'desconhecida'}.`,
          { cell: reference },
        );
      }
      if (value && value.length > limits.maxCellLength) {
        throw new ImportFileError('LIMIT_EXCEEDED', 'Uma célula excede o limite configurado.', {
          rowNumber,
          maxCellLength: limits.maxCellLength,
        });
      }
      cells[columnIndex] = value;
    });

    return { rowNumber, cells };
  });
}

function isNonEmptyRow(row: { cells: readonly (string | null)[] }): boolean {
  return row.cells.some((value) => value !== null && value.trim() !== '');
}

export function listXlsxWorksheets(
  bytes: Uint8Array,
  limits: ImportLimits,
): readonly XlsxWorksheetInfo[] {
  inspectXlsxContainer(bytes, limits);

  let entries: Readonly<Record<string, Uint8Array>>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new ImportFileError('INVALID_XLSX', 'Não foi possível descompactar o arquivo XLSX.');
  }

  return readWorksheetDescriptors(entries).map(({ name }, index) => ({
    name,
    position: index + 1,
  }));
}

export function parseXlsx(
  bytes: Uint8Array,
  limits: ImportLimits,
  options: XlsxParserOptions = {},
): ParsedTable {
  inspectXlsxContainer(bytes, limits);

  let entries: Readonly<Record<string, Uint8Array>>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new ImportFileError('INVALID_XLSX', 'Não foi possível descompactar o arquivo XLSX.');
  }

  const worksheets = readWorksheetDescriptors(entries);
  const sharedStrings = readSharedStrings(entries);
  const requestedWorksheet = options.worksheetName
    ? worksheets.find(({ name }) => name === options.worksheetName)
    : undefined;

  if (options.worksheetName && !requestedWorksheet) {
    throw new ImportFileError(
      'WORKSHEET_NOT_FOUND',
      `Planilha não encontrada: ${options.worksheetName}`,
      { availableWorksheets: worksheets.map(({ name }) => name) },
    );
  }

  let selected = requestedWorksheet
    ? {
        worksheet: requestedWorksheet,
        rows: readWorksheetRows(entries, requestedWorksheet, sharedStrings, limits),
      }
    : undefined;

  if (!selected) {
    const parsedWorksheets = worksheets.map((worksheet) => ({
      worksheet,
      rows: readWorksheetRows(entries, worksheet, sharedStrings, limits),
    }));
    const nonEmptyWorksheets = parsedWorksheets.filter(({ rows }) => rows.some(isNonEmptyRow));
    if (nonEmptyWorksheets.length > 1) {
      throw new ImportFileError(
        'MULTIPLE_WORKSHEETS',
        'O XLSX possui múltiplas planilhas com dados; selecione uma explicitamente.',
        { worksheets: nonEmptyWorksheets.map(({ worksheet }) => worksheet.name) },
      );
    }
    selected = nonEmptyWorksheets[0];
  }

  if (!selected) {
    throw new ImportFileError('EMPTY_FILE', 'O XLSX não contém planilhas com dados.');
  }

  const headerRow = options.headerRowNumber
    ? selected.rows.find(({ rowNumber }) => rowNumber === options.headerRowNumber)
    : selected.rows.find(isNonEmptyRow);

  if (!headerRow) {
    throw new ImportFileError('EMPTY_HEADER', 'Não foi possível localizar o cabeçalho do XLSX.');
  }

  const headerWidth = headerRow.cells.length;
  const headers = validateHeaders(headerRow.cells.slice(0, headerWidth));
  const rows: ParsedImportRow[] = [];

  for (const row of selected.rows) {
    if (row.rowNumber <= headerRow.rowNumber) continue;
    if (rows.length >= limits.maxRows) {
      throw new ImportFileError('LIMIT_EXCEEDED', 'O XLSX excede o limite de linhas.', {
        maxRows: limits.maxRows,
      });
    }

    if (row.cells.slice(headers.length).some((value) => value !== null)) {
      throw new ImportFileError(
        'INVALID_XLSX',
        'Linha possui dados além das colunas do cabeçalho.',
        {
          rowNumber: row.rowNumber,
        },
      );
    }

    const rawData: Record<string, string | null> = {};
    headers.forEach((header, index) => {
      const value = row.cells[index] ?? '';
      rawData[header] = value.trim() === '' ? null : value;
    });
    rows.push({ rowNumber: row.rowNumber, rawData });
  }

  return {
    format: 'XLSX',
    headers,
    rows,
    metadata: {
      worksheetName: selected.worksheet.name,
      worksheets: worksheets.map(({ name }) => name),
      headerRowNumber: headerRow.rowNumber,
    },
  };
}
