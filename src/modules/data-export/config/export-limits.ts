import type { ExportLimits } from '../domain/types';

export const DEFAULT_EXPORT_LIMITS: ExportLimits = Object.freeze({
  pageSize: 500,
  maxRows: 100_000,
  maxSelectedIds: 10_000,
  maxCellLength: 32_767,
  maxOutputBytes: 50 * 1024 * 1024,
});

export function resolveExportLimits(overrides: Partial<ExportLimits> = {}): ExportLimits {
  const limits = { ...DEFAULT_EXPORT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Limite de exportação inválido: ${name}.`);
    }
  }
  if (limits.pageSize > 500) throw new Error('Página de exportação não pode exceder 500 linhas.');
  if (limits.maxSelectedIds > 10_000) {
    throw new Error('Seleção de exportação não pode exceder 10.000 identificadores.');
  }
  return limits;
}
