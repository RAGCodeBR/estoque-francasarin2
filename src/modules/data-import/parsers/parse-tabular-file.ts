import { resolveImportLimits } from '../config/import-limits';
import { ImportFileError } from '../domain/errors';
import type {
  ImportFile,
  ImportLimits,
  ImportParserOptions,
  ParsedTable,
  TabularFormat,
} from '../domain/types';
import { calculateSha256 } from '../infrastructure/file-hash';
import { parseCsv } from './csv-parser';
import { parseXlsx } from './xlsx-parser';

export interface LoadedImportFile {
  bytes: Uint8Array;
  fileHash: string;
  parsed: ParsedTable;
}

function detectFormat(fileName: string): TabularFormat {
  const extension = fileName.split('.').pop()?.toLocaleLowerCase('en-US');

  if (extension === 'csv') return 'CSV';
  if (extension === 'xlsx') return 'XLSX';

  throw new ImportFileError(
    'INVALID_FILE_TYPE',
    'Formato não suportado. Utilize arquivos .csv ou .xlsx.',
    { fileName },
  );
}

export async function loadAndParseImportFile(
  file: ImportFile,
  parserOptions: ImportParserOptions = {},
  limitOverrides: Partial<ImportLimits> = {},
): Promise<LoadedImportFile> {
  const limits = resolveImportLimits(limitOverrides);

  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new ImportFileError('EMPTY_FILE', 'O arquivo está vazio ou possui tamanho inválido.');
  }

  if (file.size > limits.maxFileSizeBytes) {
    throw new ImportFileError('FILE_TOO_LARGE', 'O arquivo excede o limite configurado.', {
      fileSizeBytes: file.size,
      maxFileSizeBytes: limits.maxFileSizeBytes,
    });
  }

  const format = detectFormat(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.byteLength !== file.size) {
    throw new ImportFileError('INVALID_FILE_TYPE', 'O tamanho lido não corresponde ao arquivo.');
  }

  if (bytes.byteLength > limits.maxFileSizeBytes) {
    throw new ImportFileError('FILE_TOO_LARGE', 'O arquivo excede o limite configurado.');
  }

  const fileHash = await calculateSha256(bytes);
  const parsed =
    format === 'CSV'
      ? parseCsv(bytes, limits, parserOptions.csv)
      : parseXlsx(bytes, limits, parserOptions.xlsx);

  return { bytes, fileHash, parsed };
}
