import { describe, expect, it } from 'vitest';

import {
  NfeImportService,
  type NfeRepository,
  type NfeXmlStorage,
  type StageNfeInput,
} from '../../../src/modules/invoices';
import { createNfeXml, xmlFile } from '../../fixtures/nfe-xml';

class MemoryNfeRepository implements NfeRepository {
  staged: StageNfeInput | null = null;

  stage(input: StageNfeInput): Promise<string> {
    this.staged = input;
    return Promise.resolve('11111111-1111-4111-8111-111111111111');
  }

  review(): Promise<'PENDING_REVIEW' | 'READY'> {
    return Promise.resolve('READY');
  }

  confirm(): ReturnType<NfeRepository['confirm']> {
    return Promise.resolve({
      invoiceId: '22222222-2222-4222-8222-222222222222',
      itemsCreated: 2,
      movementsCreated: 2,
      supplierMappingsCreated: 0,
      applied: true,
    });
  }
}

class MemoryNfeStorage implements NfeXmlStorage {
  hash: string | null = null;

  store(_file: Parameters<NfeXmlStorage['store']>[0], fileHash: string): Promise<string> {
    this.hash = fileHash;
    return Promise.resolve(`actor/${fileHash}.xml`);
  }
}

describe('orquestração de NF-e', () => {
  it('valida, calcula hash, armazena e só então cria staging', async () => {
    const repository = new MemoryNfeRepository();
    const storage = new MemoryNfeStorage();
    const id = await new NfeImportService(repository, storage).upload(xmlFile(createNfeXml()));

    expect(id).toBe('11111111-1111-4111-8111-111111111111');
    expect(storage.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(repository.staged).toMatchObject({
      fileHash: storage.hash,
      originalFilePath: `actor/${String(storage.hash)}.xml`,
      invoice: { invoiceNumber: '123' },
    });
  });

  it('normaliza IDs e exige chave de idempotência na confirmação', async () => {
    const service = new NfeImportService(new MemoryNfeRepository());
    await expect(
      service.confirm(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        ' confirm:123 ',
      ),
    ).resolves.toMatchObject({ applied: true, movementsCreated: 2 });
    expect(() =>
      service.confirm(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        ' ',
      ),
    ).toThrow(/obrigatório/);
  });
});
