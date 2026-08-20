import {
  assertUuid,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../../utils/domain-values';
import type { NfeXmlLimits } from '../config/nfe-limits';
import type { NfeConfirmationReport, NfeItemResolution, NfeXmlFile } from '../domain/types';
import { parseNfeXmlFile } from '../parsers/nfe-xml-parser';
import type { NfeRepository } from '../ports/nfe-repository';
import type { NfeXmlStorage } from '../ports/nfe-xml-storage';

export class NfeImportService {
  constructor(
    private readonly repository: NfeRepository,
    private readonly storage?: NfeXmlStorage,
  ) {}

  async upload(
    file: NfeXmlFile,
    originalFilePath?: string | null,
    limits?: NfeXmlLimits,
  ): Promise<string> {
    const parsed = await parseNfeXmlFile(file, limits);
    const explicitPath = normalizeOptionalText(originalFilePath);
    const storedPath =
      explicitPath ?? (this.storage ? await this.storage.store(file, parsed.fileHash) : null);
    return this.repository.stage({ ...parsed, originalFilePath: storedPath });
  }

  review(
    importId: string,
    supplierId: string,
    items: readonly NfeItemResolution[],
  ): Promise<'PENDING_REVIEW' | 'READY'> {
    const normalizedItems = items.map((item) => ({
      itemId: assertUuid(item.itemId, 'ID do item'),
      productId: assertUuid(item.productId, 'ID do produto'),
      unit: item.unit,
      createSupplierMapping: item.createSupplierMapping ?? false,
    }));
    return this.repository.review(
      assertUuid(importId, 'ID da importação da NF-e'),
      assertUuid(supplierId, 'ID do fornecedor'),
      normalizedItems,
    );
  }

  confirm(
    importId: string,
    destinationLocationId: string,
    idempotencyKey: string,
  ): Promise<NfeConfirmationReport> {
    return this.repository.confirm(
      assertUuid(importId, 'ID da importação da NF-e'),
      assertUuid(destinationLocationId, 'ID do local de estoque'),
      normalizeRequiredText(idempotencyKey, 'Chave de idempotência'),
    );
  }
}
