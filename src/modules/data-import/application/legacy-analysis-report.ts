import type {
  LegacyMigrationAnalysis,
  LegacySourceAnalysis,
  LegacyValueFrequency,
} from '../domain/legacy-analysis-types';

function text(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');
}

function valueOrPending(value: number | null): string {
  return value === null ? 'NÃO IDENTIFICADO — confirmar ColumnMapping' : String(value);
}

function frequencies(values: readonly LegacyValueFrequency[] | null): string {
  if (values === null) return 'NÃO IDENTIFICADO — confirmar ColumnMapping';
  if (values.length === 0) return 'Nenhum valor informado';
  return values.map(({ value, count }) => `${text(value)} (${String(count)})`).join(', ');
}

function sourceSection(source: LegacySourceAnalysis): string {
  const lines = [
    `## Origem ${String(source.position)} — ${text(source.name)}`,
    '',
    `- Status: ${source.status}`,
    `- Linha do cabeçalho: ${source.headerRowNumber === null ? 'não identificada' : String(source.headerRowNumber)}`,
    `- Linhas de dados: ${String(source.rowCount)}`,
    `- Candidata a tabela de produtos: ${source.productTableCandidate ? 'SIM' : 'NÃO/AGUARDANDO MAPEAMENTO'}`,
    '',
  ];

  if (!source.summary) {
    lines.push('A origem não pôde ser analisada. Consulte os problemas abaixo.', '');
  } else {
    const summary = source.summary;
    lines.push(
      '### Resumo de qualidade',
      '',
      '| Métrica | Resultado |',
      '| --- | --- |',
      `| Total de produtos/linhas candidatas | ${String(summary.totalProducts)} |`,
      `| SKUs únicos | ${valueOrPending(summary.uniqueSkus)} |`,
      `| SKUs duplicados | ${String(summary.duplicateSkus.length)} grupos |`,
      `| EANs informados | ${summary.eans ? String(summary.eans.informed) : 'NÃO IDENTIFICADO'} |`,
      `| EANs válidos | ${summary.eans ? String(summary.eans.valid) : 'NÃO IDENTIFICADO'} |`,
      `| EANs inválidos | ${summary.eans ? String(summary.eans.invalid.length) : 'NÃO IDENTIFICADO'} |`,
      `| Produtos sem categoria | ${valueOrPending(summary.productsWithoutCategory)} |`,
      `| Produtos sem unidade | ${valueOrPending(summary.productsWithoutUnit)} |`,
      `| Quantidades inválidas | ${summary.invalidQuantities ? String(summary.invalidQuantities.length) : 'NÃO IDENTIFICADO'} |`,
      `| Quantidades negativas | ${summary.negativeQuantities ? String(summary.negativeQuantities.length) : 'NÃO IDENTIFICADO'} |`,
      `| Candidatos a produto duplicado | ${String(summary.duplicateProductCandidates.length)} grupos |`,
      `| Campos desconhecidos/ambíguos | ${summary.unknownFields.length === 0 ? 'Nenhum' : summary.unknownFields.map(text).join(', ')} |`,
      '',
      `- Categorias: ${frequencies(summary.categories)}`,
      `- Tipos: ${frequencies(summary.productTypes)}`,
      `- Unidades: ${frequencies(summary.units)}`,
      '',
    );
  }

  lines.push(
    '### Colunas e tipos observados',
    '',
    '| Coluna | Preenchidos | Vazios | Únicos | Tipos observados | Amostras |',
    '| --- | ---: | ---: | ---: | --- | --- |',
  );
  for (const column of source.columns) {
    const types = Object.entries(column.inferredTypes)
      .map(([type, count]) => `${type}: ${String(count)}`)
      .join(', ');
    lines.push(
      `| ${text(column.name)} | ${String(column.nonEmptyValues)} | ${String(column.emptyValues)} | ${String(column.uniqueValues)} | ${types || '—'} | ${column.sampleValues.map(text).join(', ') || '—'} |`,
    );
  }
  if (source.columns.length === 0) lines.push('| — | 0 | 0 | 0 | — | — |');

  lines.push(
    '',
    '### Proposta de ColumnMapping',
    '',
    '> PROPOSTA SOMENTE. Nenhum mapeamento desta seção é aplicado automaticamente.',
    '',
    '| ORIGINAL | DESTINO | Estado | Confiança | Motivo |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const mapping of source.columnMapping) {
    lines.push(
      `| ${text(mapping.sourceColumn)} | ${mapping.targetField ?? 'REVISAR'} | ${mapping.status} | ${mapping.confidence} | ${text(mapping.reason)} |`,
    );
  }
  if (source.columnMapping.length === 0)
    lines.push('| — | REVISAR | REVIEW_REQUIRED | NONE | Origem não analisada |');

  lines.push(
    '',
    '### Transformações propostas',
    '',
    '> Cada transformação exige revisão. O valor ORIGINAL permanece preservado.',
    '',
    '| Campo | ORIGINAL | DESTINO | Ocorrências | Estado | Motivo |',
    '| --- | --- | --- | ---: | --- | --- |',
  );
  for (const transformation of source.transformations) {
    lines.push(
      `| ${transformation.field} | ${text(transformation.original)} | ${transformation.destination === null ? 'REVISAR' : text(transformation.destination)} | ${String(transformation.occurrences)} | ${transformation.status} | ${text(transformation.reason)} |`,
    );
  }
  if (source.transformations.length === 0) {
    lines.push('| — | — | — | 0 | — | Nenhuma transformação identificada |');
  }

  lines.push(
    '',
    '### Problemas encontrados',
    '',
    '| Severidade | Código | Linha | Campo | Valor | Problema | Ação sugerida |',
    '| --- | --- | ---: | --- | --- | --- | --- |',
  );
  for (const finding of source.findings) {
    lines.push(
      `| ${finding.severity} | ${finding.code} | ${finding.rowNumber === undefined ? '—' : String(finding.rowNumber)} | ${finding.field ? text(finding.field) : '—'} | ${finding.value === undefined || finding.value === null ? '—' : text(finding.value)} | ${text(finding.problem)} | ${text(finding.suggestedAction)} |`,
    );
  }
  if (source.findings.length === 0)
    lines.push(
      '| INFO | NONE | — | — | — | Nenhum problema detectado | Prosseguir para revisão humana |',
    );
  lines.push('');
  return lines.join('\n');
}

export function serializeLegacyAnalysisJson(analysis: LegacyMigrationAnalysis): string {
  return `${JSON.stringify(analysis, null, 2)}\n`;
}

export function serializeLegacyAnalysisMarkdown(analysis: LegacyMigrationAnalysis): string {
  const sources = analysis.sources.map(sourceSection).join('\n');
  return [
    '# Ensaio de migração — relatório de análise somente leitura',
    '',
    `- Schema do relatório: ${String(analysis.reportSchemaVersion)}`,
    `- Arquivo original: ${text(analysis.file.originalFilename)}`,
    `- Formato: ${analysis.file.format}`,
    `- Tamanho: ${String(analysis.file.sizeBytes)} bytes`,
    `- SHA-256: \`${analysis.file.sha256}\``,
    `- Analisado em: ${analysis.analyzedAt}`,
    `- Origens disponíveis: ${analysis.availableSources.map(({ name }) => text(name)).join(', ')}`,
    '',
    '## Garantias deste ensaio',
    '',
    '- Arquivo original não alterado.',
    '- Nenhuma escrita em `products`, `categories`, `stock_balances` ou `stock_movements`.',
    '- Nenhuma escrita em staging.',
    '- Nenhum dry-run executado nesta fase.',
    '- Nenhuma confirmação preparada ou executada.',
    '- Propostas de mapeamento e transformação exigem aprovação humana.',
    '',
    '## Totais do arquivo',
    '',
    `- Planilhas/tabelas: ${String(analysis.totals.sources)}`,
    `- Origens analisadas: ${String(analysis.totals.analyzedSources)}`,
    `- Linhas observadas: ${String(analysis.totals.rows)}`,
    `- Linhas em origens candidatas a produtos: ${String(analysis.totals.productCandidateRows)}`,
    `- Erros: ${String(analysis.totals.errors)}`,
    `- Warnings: ${String(analysis.totals.warnings)}`,
    '',
    sources,
    '## Próxima barreira',
    '',
    'Revisar e confirmar `ColumnMapping` e `ValueMapping`. Depois, criar staging e executar dry-run. Este relatório não autoriza importação nem produção.',
    '',
  ].join('\n');
}
