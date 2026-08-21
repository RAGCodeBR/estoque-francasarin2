import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptsDirectory = resolve(process.cwd(), 'scripts', 'backup');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function script(name: string): Promise<string> {
  return readFile(resolve(scriptsDirectory, name), 'utf8');
}

async function expectCommandFailure(
  command: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await command;
    throw new Error('Expected command to fail.');
  } catch (error: unknown) {
    if (typeof error !== 'object' || error === null || !('stderr' in error)) throw error;
    const stderr = (error as Readonly<Record<string, unknown>>).stderr;
    if (typeof stderr !== 'string') throw error;
    expect(stderr).toContain(expectedMessage);
  }
}

async function createValidDatabaseBackup(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'estoque-backup-test-'));
  temporaryDirectories.push(directory);
  const payloads: Readonly<Record<string, string>> = {
    'roles.sql': '-- roles',
    'schema.sql': '-- schema',
    'data.sql': '-- data',
    'history_schema.sql': '-- migration schema',
    'history_data.sql': '-- migration data',
    'migrations.zip': 'zip fixture',
    'backup-metadata.json': JSON.stringify({
      kind: 'SUPABASE_POSTGRES_LOGICAL',
      status: 'COMPLETE',
    }),
  };
  await Promise.all(
    Object.entries(payloads).map(([name, content]) => writeFile(join(directory, name), content)),
  );
  const manifest = await Promise.all(
    Object.keys(payloads).map(async (name) => {
      const bytes = await readFile(join(directory, name));
      return {
        path: relative(directory, join(directory, name)).replaceAll('\\', '/'),
        sizeBytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
  );
  await writeFile(join(directory, 'manifest.sha256.json'), JSON.stringify(manifest));
  return directory;
}

describe('scripts de backup e restore', () => {
  it('executa o pré-voo antes de qualquer dump ou cópia de Storage', async () => {
    const database = await script('backup-database.ps1');
    const storage = await script('backup-storage.ps1');
    expect(database.indexOf('Invoke-SupabasePreflight')).toBeLessThan(
      database.indexOf('supabase db dump'),
    );
    expect(storage.indexOf('Invoke-SupabasePreflight')).toBeLessThan(
      storage.indexOf('supabase storage ls'),
    );
    expect(database).not.toContain('--password');
    expect(storage).not.toContain('service_role');
  });

  it('não contém restore automático de produção nem comandos de limpeza', async () => {
    const restore = await script('restore-test-database.ps1');
    expect(restore).toContain('if ($TargetProjectRef -eq $ProductionProjectRef)');
    expect(restore).toContain('RESTORE TEST DATABASE');
    expect(restore).not.toMatch(/--clean|db reset|DROP DATABASE|supabase backups restore/i);
  });

  it('valida manifestos SHA-256 e detecta alteração posterior', async () => {
    const directory = await createValidDatabaseBackup();
    const validator = resolve(scriptsDirectory, 'validate-backup.ps1');
    const valid = await execFileAsync('pwsh', [
      '-NoProfile',
      '-File',
      validator,
      '-BackupDirectory',
      directory,
    ]);
    expect(valid.stdout).toContain('Backup integrity validation passed');

    await writeFile(join(directory, 'data.sql'), '-- tampered');
    await expectCommandFailure(
      execFileAsync('pwsh', ['-NoProfile', '-File', validator, '-BackupDirectory', directory]),
      'SHA-256 mismatch',
    );
  }, 15_000);

  it('recusa o project ref produtivo antes de consultar credenciais ou psql', async () => {
    const restore = resolve(scriptsDirectory, 'restore-test-database.ps1');
    const productionRef = 'abcdefghijklmnopqrst';
    await expectCommandFailure(
      execFileAsync('pwsh', [
        '-NoProfile',
        '-File',
        restore,
        '-BackupDirectory',
        'unused',
        '-TargetProjectRef',
        productionRef,
        '-ProductionProjectRef',
        productionRef,
        '-Confirmation',
        `RESTORE TEST DATABASE ${productionRef}`,
      ]),
      'must not be the production',
    );
  }, 15_000);
});
