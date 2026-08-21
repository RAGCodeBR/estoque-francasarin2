import type {
  ImportTargetField,
  ProductImportMode,
  ProductImportPreviewRow,
  ProductImportPreviewSummary,
} from '../../../modules/data-import';

export const IMPORT_WIZARD_STEPS = [
  { number: 1, shortLabel: 'Upload', label: 'Enviar arquivo' },
  { number: 2, shortLabel: 'Colunas', label: 'Identificar colunas' },
  { number: 3, shortLabel: 'Mapeamento', label: 'Mapear colunas' },
  { number: 4, shortLabel: 'Valores', label: 'Mapear valores' },
  { number: 5, shortLabel: 'Validação', label: 'Validar dados' },
  { number: 6, shortLabel: 'Preview', label: 'Revisar exemplos' },
  { number: 7, shortLabel: 'Dry-run', label: 'Simular impacto' },
  { number: 8, shortLabel: 'Conflitos', label: 'Resolver conflitos' },
  { number: 9, shortLabel: 'Confirmar', label: 'Confirmar importação' },
  { number: 10, shortLabel: 'Resultado', label: 'Ver resultado' },
] as const;

export const TARGET_LABELS: Readonly<Record<ImportTargetField | 'IGNORE', string>> = {
  IGNORE: 'Ignorar coluna',
  sku: 'SKU / código',
  name: 'Produto',
  ean: 'EAN / GTIN',
  external_id: 'ID externo',
  opening_quantity: 'Quantidade atual',
  minimum_quantity: 'Quantidade mínima',
  unit: 'Unidade',
  category: 'Categoria',
  product_type: 'Tipo de produto',
};

const baseTargets: readonly ImportTargetField[] = [
  'sku',
  'name',
  'ean',
  'external_id',
  'minimum_quantity',
  'unit',
  'category',
  'product_type',
];

export function targetsForMode(mode: ProductImportMode): readonly (ImportTargetField | 'IGNORE')[] {
  return mode === 'INITIAL_MIGRATION'
    ? ['IGNORE', ...baseTargets.slice(0, 4), 'opening_quantity', ...baseTargets.slice(4)]
    : ['IGNORE', ...baseTargets];
}

export function categoryCandidates(rows: readonly ProductImportPreviewRow[]): readonly string[] {
  return [
    ...new Set(
      rows
        .flatMap((row) => (row.categoryCandidate ? [row.categoryCandidate.normalizedName] : []))
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right, 'pt-BR'));
}

export function dryRunCards(summary: ProductImportPreviewSummary) {
  return [
    { label: 'Produtos novos', value: summary.NEW, tone: 'success' },
    { label: 'Produtos existentes', value: summary.UPDATE_CANDIDATE, tone: 'neutral' },
    { label: 'Categorias novas', value: summary.CATEGORIES_NEW, tone: 'brown' },
    { label: 'Erros', value: Math.max(0, summary.INVALID - summary.CONFLICT), tone: 'danger' },
    { label: 'Conflitos', value: summary.CONFLICT, tone: 'warning' },
    { label: 'Ignorados', value: summary.IGNORED, tone: 'neutral' },
  ] as const;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${String(milliseconds)} ms`;
  const seconds = milliseconds / 1000;
  return seconds < 60
    ? `${seconds.toFixed(1)} s`
    : `${String(Math.floor(seconds / 60))} min ${String(Math.round(seconds % 60))} s`;
}
