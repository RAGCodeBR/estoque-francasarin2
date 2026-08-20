import type { ConfirmProductImportOptions, ProductImportReport } from '../domain/types';

/**
 * A implementação deve chamar a confirmação transacional do banco.
 * Este contrato não permite gravar products ou stock_balances diretamente.
 */
export interface ImportConfirmationRepository {
  confirmProductImport(options: ConfirmProductImportOptions): Promise<ProductImportReport>;
}
