import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const scriptPath = resolve(process.cwd(), 'scripts', 'migration', 'analyze-legacy-file.ts');
const tsxCli = resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      if (process.platform === 'win32') {
        await execFileAsync('attrib', ['-R', join(directory, '*'), '/S', '/D'], {
          windowsHide: true,
        }).catch(() => undefined);
      }
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

function hash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('comando offline de custódia e análise', () => {
  it('preserva cópia somente leitura, verifica hash e gera relatórios sem alterar o original', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'estoque-legacy-analysis-'));
    temporaryDirectories.push(directory);
    const source = join(directory, 'dados antigos.csv');
    const evidence = join(directory, 'evidence');
    const original = new TextEncoder().encode(
      'COD;DESCRICAO;GRUPO;TIPO;UNIDADE;SALDO\r\n001;Arroz;Secos;BRUTO;KG;12,5\r\n',
    );
    await writeFile(source, original);
    const before = await stat(source);

    const result = await execFileAsync(
      process.execPath,
      [tsxCli, scriptPath, '--source', source, '--evidence-dir', evidence],
      { windowsHide: true },
    );
    expect(result.stdout).toContain('Ensaio somente leitura concluído.');
    expect(result.stdout).toContain('Nenhum staging, dry-run, confirmação ou acesso ao Supabase');

    const cases = await readdir(evidence);
    expect(cases).toHaveLength(1);
    const caseDirectory = join(evidence, cases[0] ?? 'missing');
    const manifest = JSON.parse(
      await readFile(join(caseDirectory, 'custody-manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      kind: 'LEGACY_MIGRATION_EVIDENCE',
      originalFilename: 'dados antigos.csv',
      sizeBytes: original.byteLength,
      sha256: hash(original),
      readOnly: true,
      analysisMode: 'READ_ONLY_LEGACY_ANALYSIS',
    });
    const preserved = await readFile(
      join(caseDirectory, 'original-read-only', 'dados antigos.csv'),
    );
    expect(hash(preserved)).toBe(hash(original));
    expect(await readFile(source)).toEqual(Buffer.from(original));
    const after = await stat(source);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);

    const reportRuns = await readdir(join(caseDirectory, 'reports'));
    expect(reportRuns).toHaveLength(1);
    const reportDirectory = join(caseDirectory, 'reports', reportRuns[0] ?? 'missing');
    const analysis = JSON.parse(
      await readFile(join(reportDirectory, 'analysis.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(analysis).toMatchObject({
      mode: 'READ_ONLY_LEGACY_ANALYSIS',
      stagingExecuted: false,
      dryRunExecuted: false,
      confirmationPrepared: false,
    });
    expect(analysis.file).toMatchObject({ sha256: hash(original) });
    expect(await readFile(join(reportDirectory, 'analysis.md'), 'utf8')).toContain(
      'Proposta de ColumnMapping',
    );
  }, 20_000);

  it('não contém caminho de confirmação, escrita no Supabase ou remoção do original', async () => {
    const source = await readFile(scriptPath, 'utf8');
    expect(source).not.toMatch(/createClient|service_role|confirm_product_import|stock_balances/i);
    expect(source).not.toMatch(/unlink|rm\(|rename\(|truncate/i);
    expect(source).toContain('COPYFILE_EXCL');
    expect(source).toContain("analysisMode: 'READ_ONLY_LEGACY_ANALYSIS'");
  });
});
