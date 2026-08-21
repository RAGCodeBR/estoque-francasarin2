import type {
  ImportResultDetails,
  ProductImportPreviewSummary,
} from '../domain/import-wizard-types';

export function isProductImportConfirmable(summary: ProductImportPreviewSummary): boolean {
  return summary.INVALID === 0 && summary.CONFLICT === 0;
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeImportReport(details: ImportResultDetails): string {
  const report = details.report;
  const rows: readonly [string, string | number | boolean][] = [
    ['export_schema_version', 1],
    ['batch_id', report.batchId],
    ['modo', report.importMode],
    ['arquivo', details.filename],
    ['origem', details.sourceName],
    ['aplicado', report.applied],
    ['produtos_criados', report.productsCreated],
    ['produtos_associados', report.productsAssociated],
    ['produtos_atualizados', report.productsUpdated],
    ['categorias_criadas', report.categoriesCreated],
    ['movimentacoes_criadas', report.movementsCreated],
    ['linhas_ignoradas', report.linesIgnored],
    ['quantidades_externas_ignoradas', report.externalQuantitiesIgnored],
    ['warnings', report.warnings],
    ['erros', report.errors],
    ['inicio', details.startedAt],
    ['conclusao', details.finishedAt],
    ['duracao_ms', details.elapsedMilliseconds],
  ];
  return `\uFEFFcampo;valor\r\n${rows
    .map(([field, value]) => `${csvCell(field)};${csvCell(value)}`)
    .join('\r\n')}\r\n`;
}
