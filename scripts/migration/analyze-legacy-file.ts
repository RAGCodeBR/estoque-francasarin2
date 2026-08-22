import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, parse, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  analyzeLegacyMigrationFile,
  serializeLegacyAnalysisJson,
  serializeLegacyAnalysisMarkdown,
} from '../../src/modules/data-import';
import type {
  AnalyzeLegacyMigrationFileInput,
  LegacyAnalysisCustodyManifest,
  LegacySourceConfiguration,
} from '../../src/modules/data-import';
import { IMPORT_TARGET_FIELDS } from '../../src/modules/data-import/domain/types';

const execFileAsync = promisify(execFile);

interface CliArguments {
  source: string;
  evidenceDirectory: string;
  config?: string;
}

type AnalysisOptions = Pick<
  AnalyzeLegacyMigrationFileInput,
  'parserOptions' | 'sourceConfigurations' | 'valueMappings'
>;

function usage(): string {
  return [
    'Uso:',
    '  npm run migration:analyze -- --source <arquivo.csv|xlsx> --evidence-dir <diretorio> [--config <analysis-config.json>]',
    '',
    'O comando cria uma cópia somente leitura, manifestos SHA-256 e relatórios offline.',
    'Ele não acessa Supabase, não cria staging e não confirma importações.',
  ].join('\n');
}

function parseArguments(values: readonly string[]): CliArguments {
  if (values.includes('--help') || values.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new TypeError(`Argumento inválido.\n${usage()}`);
    }
    if (parsed.has(key)) throw new TypeError(`Argumento repetido: ${key}`);
    parsed.set(key, value);
  }
  const allowed = new Set(['--source', '--evidence-dir', '--config']);
  const unknown = [...parsed.keys()].find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`Argumento desconhecido: ${unknown}`);
  const source = parsed.get('--source');
  const evidenceDirectory = parsed.get('--evidence-dir');
  if (!source || !evidenceDirectory) throw new TypeError(usage());
  const config = parsed.get('--config');
  return { source, evidenceDirectory, ...(config ? { config } : {}) };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} deve ser um inteiro positivo.`);
  }
  return Number(value);
}

function parseColumnMapping(
  value: unknown,
  source: string,
): LegacySourceConfiguration['columnMapping'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`columnMapping de ${source} deve ser uma lista.`);
  const targets = new Set<string>([...IMPORT_TARGET_FIELDS, 'IGNORE']);
  return value.map((entry, index) => {
    if (!isRecord(entry))
      throw new TypeError(`ColumnMapping inválido em ${source}[${String(index)}].`);
    const sourceColumn = entry.sourceColumn;
    const targetField = entry.targetField;
    if (typeof sourceColumn !== 'string' || !targets.has(String(targetField))) {
      throw new TypeError(`ColumnMapping inválido em ${source}[${String(index)}].`);
    }
    return {
      sourceColumn,
      targetField: targetField as (typeof IMPORT_TARGET_FIELDS)[number] | 'IGNORE',
    };
  });
}

function parseSourceConfigurations(
  value: unknown,
): Readonly<Record<string, LegacySourceConfiguration>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError('sourceConfigurations deve ser um objeto.');
  return Object.fromEntries(
    Object.entries(value).map(([source, configuration]) => {
      if (!isRecord(configuration)) {
        throw new TypeError(`Configuração inválida para a origem ${source}.`);
      }
      const headerRowNumber = positiveInteger(
        configuration.headerRowNumber,
        `headerRowNumber de ${source}`,
      );
      const columnMapping = parseColumnMapping(configuration.columnMapping, source);
      return [
        source,
        {
          ...(headerRowNumber ? { headerRowNumber } : {}),
          ...(columnMapping ? { columnMapping } : {}),
        },
      ];
    }),
  );
}

function parseValueMappings(value: unknown): AnalysisOptions['valueMappings'] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError('valueMappings deve ser um objeto.');
  const parseEntries = <T extends string>(
    entries: unknown,
    allowedTargets: ReadonlySet<T>,
    label: string,
  ): readonly { sourceValue: string; targetValue: T }[] | undefined => {
    if (entries === undefined) return undefined;
    if (!Array.isArray(entries)) throw new TypeError(`${label} deve ser uma lista.`);
    return entries.map((entry, index) => {
      if (
        !isRecord(entry) ||
        typeof entry.sourceValue !== 'string' ||
        typeof entry.targetValue !== 'string' ||
        !allowedTargets.has(entry.targetValue as T)
      ) {
        throw new TypeError(`${label}[${String(index)}] é inválido.`);
      }
      return { sourceValue: entry.sourceValue, targetValue: entry.targetValue as T };
    });
  };
  const unit = parseEntries<'UN' | 'KG'>(
    value.unit,
    new Set<'UN' | 'KG'>(['UN', 'KG']),
    'valueMappings.unit',
  );
  const productType = parseEntries<'RAW' | 'FRACTIONATED'>(
    value.productType,
    new Set<'RAW' | 'FRACTIONATED'>(['RAW', 'FRACTIONATED']),
    'valueMappings.productType',
  );
  return {
    ...(unit ? { unit } : {}),
    ...(productType ? { productType } : {}),
  };
}

function parseParserOptions(value: unknown): AnalysisOptions['parserOptions'] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError('parserOptions deve ser um objeto.');
  const csvValue = value.csv;
  const xlsxValue = value.xlsx;
  let csv: NonNullable<AnalysisOptions['parserOptions']>['csv'];
  let xlsx: NonNullable<AnalysisOptions['parserOptions']>['xlsx'];
  if (csvValue !== undefined) {
    if (!isRecord(csvValue)) throw new TypeError('parserOptions.csv deve ser um objeto.');
    const delimiters = new Set([',', ';', '\t', '|']);
    const encodings = new Set(['utf-8', 'windows-1252', 'utf-16le', 'utf-16be']);
    const delimiter = csvValue.delimiter;
    const encoding = csvValue.encoding;
    if (delimiter !== undefined && (typeof delimiter !== 'string' || !delimiters.has(delimiter))) {
      throw new TypeError('Delimiter CSV inválido.');
    }
    if (encoding !== undefined && (typeof encoding !== 'string' || !encodings.has(encoding))) {
      throw new TypeError('Encoding CSV inválido.');
    }
    const headerRowNumber = positiveInteger(
      csvValue.headerRowNumber,
      'parserOptions.csv.headerRowNumber',
    );
    csv = {
      ...(delimiter ? { delimiter: delimiter as ',' | ';' | '\t' | '|' } : {}),
      ...(encoding
        ? {
            encoding: encoding as 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be',
          }
        : {}),
      ...(headerRowNumber ? { headerRowNumber } : {}),
    };
  }
  if (xlsxValue !== undefined) {
    if (!isRecord(xlsxValue)) throw new TypeError('parserOptions.xlsx deve ser um objeto.');
    const headerRowNumber = positiveInteger(
      xlsxValue.headerRowNumber,
      'parserOptions.xlsx.headerRowNumber',
    );
    xlsx = { ...(headerRowNumber ? { headerRowNumber } : {}) };
  }
  return { ...(csv ? { csv } : {}), ...(xlsx ? { xlsx } : {}) };
}

async function readAnalysisOptions(configPath: string | undefined): Promise<AnalysisOptions> {
  if (!configPath) return {};
  const parsed: unknown = JSON.parse(await readFile(resolve(configPath), 'utf8'));
  if (!isRecord(parsed))
    throw new TypeError('O arquivo de configuração deve conter um objeto JSON.');
  const sourceConfigurations = parseSourceConfigurations(parsed.sourceConfigurations);
  const parserOptions = parseParserOptions(parsed.parserOptions);
  const valueMappings = parseValueMappings(parsed.valueMappings);
  return {
    ...(sourceConfigurations ? { sourceConfigurations } : {}),
    ...(parserOptions ? { parserOptions } : {}),
    ...(valueMappings ? { valueMappings } : {}),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function makeReadOnly(path: string): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync('attrib', ['+R', path], { windowsHide: true });
  } else {
    await chmod(path, 0o444);
  }
}

function safeStem(filename: string): string {
  const normalized = parse(filename)
    .name.normalize('NFKC')
    .replaceAll(/[^a-zA-Z0-9._-]+/g, '-');
  return normalized.replaceAll(/^-+|-+$/g, '').slice(0, 80) || 'legacy-data';
}

async function preserveEvidence(
  sourcePath: string,
  evidenceRoot: string,
): Promise<{
  bytes: Uint8Array;
  preservedPath: string;
  caseDirectory: string;
  manifest: LegacyAnalysisCustodyManifest;
}> {
  const sourceStats = await stat(sourcePath);
  if (!sourceStats.isFile()) throw new TypeError('A origem deve ser um arquivo regular.');
  const extension = extname(sourcePath).toLocaleLowerCase('en-US');
  if (extension !== '.csv' && extension !== '.xlsx') {
    throw new TypeError('Somente arquivos .csv e .xlsx são aceitos.');
  }
  const bytes = new Uint8Array(await readFile(sourcePath));
  const hash = sha256(bytes);
  const filename = basename(sourcePath);
  const caseDirectory = join(evidenceRoot, `${safeStem(filename)}-${hash.slice(0, 12)}`);
  const originalDirectory = join(caseDirectory, 'original-read-only');
  const preservedPath = join(originalDirectory, filename);
  await mkdir(originalDirectory, { recursive: true });

  try {
    await copyFile(sourcePath, preservedPath, constants.COPYFILE_EXCL);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code !== 'EEXIST') throw error;
  }
  const preservedBytes = new Uint8Array(await readFile(preservedPath));
  if (preservedBytes.byteLength !== bytes.byteLength || sha256(preservedBytes) !== hash) {
    throw new Error('A cópia preservada não corresponde ao arquivo original.');
  }
  await makeReadOnly(preservedPath);
  const sourceBytesAfterCopy = new Uint8Array(await readFile(sourcePath));
  if (
    sourceBytesAfterCopy.byteLength !== bytes.byteLength ||
    sha256(sourceBytesAfterCopy) !== hash
  ) {
    throw new Error('O arquivo original mudou durante a preservação; análise interrompida.');
  }
  const createdAt = new Date().toISOString();
  let manifest: LegacyAnalysisCustodyManifest = {
    manifestSchemaVersion: 1,
    kind: 'LEGACY_MIGRATION_EVIDENCE',
    createdAt,
    originalFilename: filename,
    preservedFilename: filename,
    sizeBytes: bytes.byteLength,
    sha256: hash,
    readOnly: true,
    analysisMode: 'READ_ONLY_LEGACY_ANALYSIS',
  };
  const manifestPath = join(caseDirectory, 'custody-manifest.json');
  try {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code !== 'EEXIST') throw error;
    const existing: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (
      !isRecord(existing) ||
      existing.sha256 !== hash ||
      existing.originalFilename !== filename ||
      typeof existing.createdAt !== 'string'
    ) {
      throw new Error('Manifesto de custódia existente não corresponde ao arquivo.', {
        cause: error,
      });
    }
    manifest = { ...manifest, createdAt: existing.createdAt };
  }
  return { bytes: preservedBytes, preservedPath, caseDirectory, manifest };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const sourcePath = resolve(args.source);
  const evidenceRoot = resolve(args.evidenceDirectory);
  const options = await readAnalysisOptions(args.config);
  const preserved = await preserveEvidence(sourcePath, evidenceRoot);
  const runDirectory = join(
    preserved.caseDirectory,
    'reports',
    new Date().toISOString().replaceAll(/[:.]/g, '-'),
  );
  await mkdir(runDirectory, { recursive: true });
  try {
    const analysis = await analyzeLegacyMigrationFile({
      file: {
        name: preserved.manifest.originalFilename,
        size: preserved.bytes.byteLength,
        arrayBuffer: () => Promise.resolve(preserved.bytes.slice().buffer),
      },
      analyzedAt: new Date().toISOString(),
      ...options,
    });
    if (analysis.file.sha256 !== preserved.manifest.sha256) {
      throw new Error('Hash do analisador diverge do manifesto de custódia.');
    }
    await Promise.all([
      writeFile(join(runDirectory, 'analysis.json'), serializeLegacyAnalysisJson(analysis), {
        flag: 'wx',
      }),
      writeFile(join(runDirectory, 'analysis.md'), serializeLegacyAnalysisMarkdown(analysis), {
        flag: 'wx',
      }),
    ]);
    process.stdout.write(
      [
        'Ensaio somente leitura concluído.',
        `Cópia preservada: ${preserved.preservedPath}`,
        `SHA-256: ${preserved.manifest.sha256}`,
        `Relatórios: ${runDirectory}`,
        'Nenhum staging, dry-run, confirmação ou acesso ao Supabase foi executado.',
      ].join('\n') + '\n',
    );
  } catch (error) {
    await writeFile(
      join(runDirectory, 'analysis-error.json'),
      `${JSON.stringify(
        {
          reportSchemaVersion: 1,
          mode: 'READ_ONLY_LEGACY_ANALYSIS',
          sha256: preserved.manifest.sha256,
          error: error instanceof Error ? error.message : 'Falha desconhecida',
          stagingExecuted: false,
          dryRunExecuted: false,
          confirmationPrepared: false,
        },
        null,
        2,
      )}\n`,
      { flag: 'wx' },
    );
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Falha desconhecida.'}\n`);
  process.exitCode = 1;
});
