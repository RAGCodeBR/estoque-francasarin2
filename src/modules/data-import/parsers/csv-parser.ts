import { ImportFileError } from '../domain/errors';
import type { CsvParserOptions, ImportLimits, ParsedImportRow, ParsedTable } from '../domain/types';
import { looksLikeFormula, validateHeaders } from './header-validation';

interface CsvRecord {
  startLine: number;
  cells: readonly string[];
}

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;
type CsvDelimiter = (typeof DELIMITER_CANDIDATES)[number];

function decodeCsv(bytes: Uint8Array, requestedEncoding?: CsvParserOptions['encoding']): string {
  let encoding = requestedEncoding;

  if (!encoding) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      encoding = 'utf-16le';
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      encoding = 'utf-16be';
    } else {
      encoding = 'utf-8';
    }
  }

  try {
    const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes);

    if (decoded.includes('\0')) {
      throw new ImportFileError('INVALID_ENCODING', 'O CSV contém bytes nulos inesperados.');
    }

    return decoded;
  } catch (error) {
    if (error instanceof ImportFileError) {
      throw error;
    }

    throw new ImportFileError(
      'INVALID_ENCODING',
      `Não foi possível decodificar o CSV como ${encoding}. Selecione o encoding correto.`,
      { encoding },
    );
  }
}

function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<(typeof DELIMITER_CANDIDATES)[number], number>(
    DELIMITER_CANDIDATES.map((candidate) => [candidate, 0]),
  );
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (character === '\r' || character === '\n')) {
      break;
    } else if (!inQuotes && DELIMITER_CANDIDATES.includes(character as never)) {
      const delimiter = character as (typeof DELIMITER_CANDIDATES)[number];
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? ',';
}

function parseRecords(text: string, delimiter: string, limits: ImportLimits): readonly CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let justClosedQuote = false;
  let line = 1;
  let recordStartLine = 1;

  const appendCharacter = (character: string) => {
    field += character;

    if (field.length > limits.maxCellLength) {
      throw new ImportFileError('LIMIT_EXCEEDED', 'Uma célula excede o limite configurado.', {
        line,
        maxCellLength: limits.maxCellLength,
      });
    }
  };

  const finishField = () => {
    cells.push(field);
    field = '';
    justClosedQuote = false;

    if (cells.length > limits.maxColumns) {
      throw new ImportFileError('LIMIT_EXCEEDED', 'O CSV excede o limite de colunas.', {
        line,
        maxColumns: limits.maxColumns,
      });
    }
  };

  const finishRecord = () => {
    finishField();
    records.push({ startLine: recordStartLine, cells });
    cells = [];
    recordStartLine = line + 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          appendCharacter('"');
          index += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') {
          index += 1;
        }
        appendCharacter('\n');
        line += 1;
      } else {
        appendCharacter(character);
      }
      continue;
    }

    if (justClosedQuote && character !== delimiter && character !== '\r' && character !== '\n') {
      throw new ImportFileError('INVALID_CSV', 'Caractere inesperado após o fechamento de aspas.', {
        line,
      });
    }

    if (character === '"') {
      if (field !== '') {
        throw new ImportFileError('INVALID_CSV', 'Aspas inesperadas em campo não delimitado.', {
          line,
        });
      }
      inQuotes = true;
    } else if (character === delimiter) {
      finishField();
    } else if (character === '\r' || character === '\n') {
      finishRecord();
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      line += 1;
      recordStartLine = line;
    } else {
      appendCharacter(character);
    }
  }

  if (inQuotes) {
    throw new ImportFileError('INVALID_CSV', 'Campo entre aspas não foi fechado.', { line });
  }

  if (field !== '' || cells.length > 0) {
    finishRecord();
  }

  return records;
}

function isBlankRecord(record: CsvRecord): boolean {
  return record.cells.every((cell) => cell.trim() === '');
}

export function parseCsv(
  bytes: Uint8Array,
  limits: ImportLimits,
  options: CsvParserOptions = {},
): ParsedTable {
  const text = decodeCsv(bytes, options.encoding);
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const records = parseRecords(text, delimiter, limits);

  if (records.length === 0) {
    throw new ImportFileError('EMPTY_FILE', 'O CSV não contém linhas.');
  }

  const headerRecord = options.headerRowNumber
    ? records.find(({ startLine }) => startLine === options.headerRowNumber)
    : records.find((record) => !isBlankRecord(record));

  if (!headerRecord) {
    throw new ImportFileError('EMPTY_HEADER', 'Não foi possível localizar uma linha de cabeçalho.');
  }

  const headers = validateHeaders(headerRecord.cells);
  const rows: ParsedImportRow[] = [];

  for (const record of records) {
    if (record.startLine <= headerRecord.startLine) {
      continue;
    }

    if (record.cells.length > headers.length) {
      throw new ImportFileError('INVALID_CSV', 'Linha possui mais colunas que o cabeçalho.', {
        rowNumber: record.startLine,
        expectedColumns: headers.length,
        actualColumns: record.cells.length,
      });
    }

    if (rows.length >= limits.maxRows) {
      throw new ImportFileError('LIMIT_EXCEEDED', 'O CSV excede o limite de linhas.', {
        maxRows: limits.maxRows,
      });
    }

    const rawData: Record<string, string | null> = {};

    headers.forEach((header, index) => {
      const value = record.cells[index] ?? '';

      if (value.trim() !== '' && looksLikeFormula(value)) {
        throw new ImportFileError(
          'FORMULA_NOT_ALLOWED',
          `Valor semelhante a fórmula encontrado na linha ${String(record.startLine)}, coluna "${header}".`,
          { rowNumber: record.startLine, column: header },
        );
      }

      rawData[header] = value.trim() === '' ? null : value;
    });

    rows.push({ rowNumber: record.startLine, rawData });
  }

  return {
    format: 'CSV',
    headers,
    rows,
    metadata: {
      delimiter: delimiter === '\t' ? 'TAB' : delimiter,
      encoding: options.encoding ?? 'auto/utf-8',
      headerRowNumber: headerRecord.startLine,
    },
  };
}
