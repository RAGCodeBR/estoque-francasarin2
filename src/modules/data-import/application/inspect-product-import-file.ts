import { resolveImportLimits } from '../config/import-limits';
import type {
  ImportFileInspection,
  InspectProductImportFileInput,
} from '../domain/import-wizard-types';
import { loadAndParseImportFile } from '../parsers/parse-tabular-file';

function positiveBounded(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`Valor deve estar entre 1 e ${String(maximum)}.`);
  }
  return value;
}

export async function inspectProductImportFile(
  input: InspectProductImportFileInput,
): Promise<ImportFileInspection> {
  const limits = resolveImportLimits(input.limits);
  const loaded = await loadAndParseImportFile(input.file, input.parserOptions, limits);
  const sampleSize = positiveBounded(input.sampleSize, 5, 20);
  const distinctValueLimit = positiveBounded(input.distinctValueLimit, 100, 500);
  const distinct = Object.fromEntries(
    loaded.parsed.headers.map((header) => {
      const values = new Set<string>();
      for (const row of loaded.parsed.rows) {
        const value = row.rawData[header]?.normalize('NFKC').trim();
        if (value) values.add(value);
        if (values.size === distinctValueLimit) break;
      }
      return [header, [...values]];
    }),
  );

  return {
    file: input.file,
    fileHash: loaded.fileHash,
    format: loaded.parsed.format,
    headers: loaded.parsed.headers,
    rows: loaded.parsed.rows,
    sampleRows: loaded.parsed.rows.slice(0, sampleSize),
    distinctValues: distinct,
    metadata: loaded.parsed.metadata,
  };
}
