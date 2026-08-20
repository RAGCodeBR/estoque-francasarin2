import type { NfeConfirmationReport, NfeItemResolution, ParsedNfeFile } from '../domain/types';

export interface StageNfeInput extends ParsedNfeFile {
  readonly originalFilePath?: string | null;
}

export interface NfeRepository {
  stage(input: StageNfeInput): Promise<string>;
  review(
    importId: string,
    supplierId: string,
    items: readonly NfeItemResolution[],
  ): Promise<'PENDING_REVIEW' | 'READY'>;
  confirm(
    importId: string,
    destinationLocationId: string,
    idempotencyKey: string,
  ): Promise<NfeConfirmationReport>;
}
