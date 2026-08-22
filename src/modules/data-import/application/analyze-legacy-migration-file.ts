import { isValidGtin } from '../../../utils/gtin';
import { resolveImportLimits } from '../config/import-limits';
import type {
  AnalyzeLegacyMigrationFileInput,
  LegacyAnalysisFinding,
  LegacyColumnMappingProposal,
  LegacyColumnProfile,
  LegacyDuplicateProductCandidate,
  LegacyDuplicateValue,
  LegacyMigrationAnalysis,
  LegacyQuantityProblem,
  LegacyScalarType,
  LegacySourceAnalysis,
  LegacySourceConfiguration,
  LegacySourceSummary,
  LegacyTransformationProposal,
  LegacyValueFrequency,
} from '../domain/legacy-analysis-types';
import { ImportFileError } from '../domain/errors';
import {
  normalizeIdentity,
  normalizeQuantity,
  normalizeSku,
  normalizeText,
} from '../domain/normalization';
import type {
  ColumnMapping,
  ImportTargetField,
  ParsedImportRow,
  ParsedTable,
  TabularFormat,
} from '../domain/types';
import {
  compileValueMapping,
  DEFAULT_VALUE_MAPPINGS,
  normalizeMappingValue,
} from '../domain/value-mapping';
import { calculateSha256 } from '../infrastructure/file-hash';
import { parseCsv } from '../parsers/csv-parser';
import { validateColumnMapping } from '../domain/column-mapping';
import { listXlsxWorksheets, parseXlsx } from '../parsers/xlsx-parser';

const HEADER_ALIASES: Readonly<
  Record<ImportTargetField, Readonly<Record<'HIGH' | 'MEDIUM', readonly string[]>>>
> = {
  sku: {
    HIGH: ['SKU', 'COD', 'CODIGO', 'CODPRODUTO', 'CODIGOPRODUTO', 'CODITEM'],
    MEDIUM: ['REFERENCIA', 'REF', 'ITEM'],
  },
  name: {
    HIGH: ['NOME', 'PRODUTO', 'DESCRICAO', 'DESCRICAOPRODUTO', 'NOMEPRODUTO'],
    MEDIUM: ['DESCR', 'NOMEITEM'],
  },
  ean: {
    HIGH: ['EAN', 'GTIN', 'CODIGOBARRAS', 'CODBARRAS'],
    MEDIUM: ['BARRAS'],
  },
  external_id: {
    HIGH: ['IDEXTERNO', 'IDLEGADO', 'LEGACYID', 'CODIGOLEGADO'],
    MEDIUM: ['ID', 'IDENTIFICADOR'],
  },
  opening_quantity: {
    HIGH: ['SALDO', 'SALDOATUAL', 'QUANTIDADEATUAL', 'ESTOQUEATUAL'],
    MEDIUM: ['QUANTIDADE', 'QTD', 'ESTOQUE'],
  },
  minimum_quantity: {
    HIGH: ['QUANTIDADEMINIMA', 'QTDMINIMA', 'ESTOQUEMINIMO', 'MINIMO'],
    MEDIUM: ['SALDOMINIMO'],
  },
  unit: {
    HIGH: ['UNIDADE', 'UNID', 'UNIT', 'UNITTYPE'],
    MEDIUM: ['UN', 'UM'],
  },
  category: {
    HIGH: ['CATEGORIA', 'GRUPO', 'GRUPOPRODUTO', 'CATEGORIAPRODUTO'],
    MEDIUM: ['FAMILIA', 'SECAO'],
  },
  product_type: {
    HIGH: ['TIPO', 'TIPOPRODUTO', 'PRODUCTTYPE'],
    MEDIUM: ['CLASSIFICACAO'],
  },
};

interface ParsedSource {
  name: string;
  position: number;
  table: ParsedTable;
  configuration: LegacySourceConfiguration;
}

function detectFormat(fileName: string): TabularFormat {
  const extension = fileName.split('.').pop()?.toLocaleLowerCase('en-US');
  if (extension === 'csv') return 'CSV';
  if (extension === 'xlsx') return 'XLSX';
  throw new ImportFileError(
    'INVALID_FILE_TYPE',
    'Formato não suportado. Utilize arquivos .csv ou .xlsx.',
    { fileName },
  );
}

function inferScalarType(value: string): LegacyScalarType {
  const normalized = value.normalize('NFKC').trim();
  if (/^(?:TRUE|FALSE|SIM|NAO|NÃO)$/iu.test(normalized)) return 'BOOLEAN';
  if (
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/u.test(normalized) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}(?: \d{1,2}:\d{2}(?::\d{2})?)?$/u.test(normalized)
  ) {
    return 'DATE';
  }
  if (/^[+-]?\d+$/u.test(normalized)) return 'INTEGER';
  if (/^[+-]?\d+[.,]\d+$/u.test(normalized)) return 'DECIMAL';
  return 'TEXT';
}

function frequency(values: readonly string[]): readonly LegacyValueFrequency[] {
  const indexed = new Map<string, { value: string; count: number }>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const identity = normalizeIdentity(normalized);
    const current = indexed.get(identity);
    if (current) current.count += 1;
    else indexed.set(identity, { value: normalized, count: 1 });
  }
  return [...indexed.values()].sort(
    (left, right) => right.count - left.count || left.value.localeCompare(right.value, 'pt-BR'),
  );
}

function profileColumns(
  table: ParsedTable,
  distinctValueSampleLimit: number,
): readonly LegacyColumnProfile[] {
  return table.headers.map((header, index) => {
    const values = table.rows.map(({ rawData }) => rawData[header] ?? null);
    const nonEmpty = values.flatMap((value) => {
      const normalized = normalizeText(value);
      return normalized ? [normalized] : [];
    });
    const frequencies = frequency(nonEmpty);
    const typeCounts: Partial<Record<LegacyScalarType, number>> = {};
    for (const value of nonEmpty) {
      const inferred = inferScalarType(value);
      typeCounts[inferred] = (typeCounts[inferred] ?? 0) + 1;
    }
    return {
      name: header,
      position: index + 1,
      nonEmptyValues: nonEmpty.length,
      emptyValues: values.length - nonEmpty.length,
      uniqueValues: frequencies.length,
      distinctValuesSample: frequencies.slice(0, distinctValueSampleLimit),
      inferredTypes: typeCounts,
      sampleValues: nonEmpty.slice(0, 5),
      sampleTruncated: frequencies.length > distinctValueSampleLimit,
    };
  });
}

function aliasProposal(header: string): LegacyColumnMappingProposal {
  const identity = normalizeMappingValue(header);
  for (const [targetField, aliases] of Object.entries(HEADER_ALIASES) as [
    ImportTargetField,
    (typeof HEADER_ALIASES)[ImportTargetField],
  ][]) {
    if (aliases.HIGH.includes(identity)) {
      return {
        sourceColumn: header,
        targetField,
        status: 'PROPOSED',
        confidence: 'HIGH',
        reason: `Cabeçalho corresponde a um alias conhecido de ${targetField}; exige aprovação humana.`,
      };
    }
    if (aliases.MEDIUM.includes(identity)) {
      return {
        sourceColumn: header,
        targetField,
        status: 'PROPOSED',
        confidence: 'MEDIUM',
        reason: `Cabeçalho é ambíguo, mas pode representar ${targetField}; revisar amostras.`,
      };
    }
  }
  return {
    sourceColumn: header,
    targetField: null,
    status: 'REVIEW_REQUIRED',
    confidence: 'NONE',
    reason: 'Campo desconhecido; mapear explicitamente ou marcar como IGNORE.',
  };
}

function mappingProposals(
  headers: readonly string[],
  confirmedMapping: readonly ColumnMapping[] | undefined,
): readonly LegacyColumnMappingProposal[] {
  if (confirmedMapping) {
    validateColumnMapping(headers, confirmedMapping);
    return confirmedMapping.map(({ sourceColumn, targetField }) => ({
      sourceColumn,
      targetField,
      status: 'CONFIRMED',
      confidence: 'HIGH',
      reason:
        targetField === 'IGNORE'
          ? 'Decisão explícita de ignorar fornecida na configuração do ensaio.'
          : 'Mapeamento confirmado fornecido na configuração do ensaio.',
    }));
  }

  const proposals = headers.map(aliasProposal);
  const byTarget = new Map<ImportTargetField, LegacyColumnMappingProposal[]>();
  for (const proposal of proposals) {
    if (!proposal.targetField || proposal.targetField === 'IGNORE') continue;
    const values = byTarget.get(proposal.targetField) ?? [];
    values.push(proposal);
    byTarget.set(proposal.targetField, values);
  }
  const conflicts = new Set(
    [...byTarget.entries()].filter(([, values]) => values.length > 1).map(([target]) => target),
  );
  return proposals.map((proposal) =>
    proposal.targetField && proposal.targetField !== 'IGNORE' && conflicts.has(proposal.targetField)
      ? {
          ...proposal,
          status: 'REVIEW_REQUIRED',
          reason: `Mais de uma coluna foi candidata a ${proposal.targetField}; selecionar somente uma.`,
        }
      : proposal,
  );
}

function selectedColumn(
  proposals: readonly LegacyColumnMappingProposal[],
  field: ImportTargetField,
): string | null {
  const matches = proposals.filter(
    ({ targetField, status }) => targetField === field && status !== 'REVIEW_REQUIRED',
  );
  return matches.length === 1 ? (matches[0]?.sourceColumn ?? null) : null;
}

function fieldValues(
  rows: readonly ParsedImportRow[],
  proposals: readonly LegacyColumnMappingProposal[],
  field: ImportTargetField,
): readonly { rowNumber: number; value: string }[] {
  const column = selectedColumn(proposals, field);
  if (!column) return [];
  return rows.flatMap(({ rowNumber, rawData }) => {
    const value = normalizeText(rawData[column]);
    return value ? [{ rowNumber, value }] : [];
  });
}

function duplicateValues(
  values: readonly { rowNumber: number; value: string }[],
  normalize: (value: string) => string | null,
): readonly LegacyDuplicateValue[] {
  const grouped = new Map<string, { value: string; rowNumbers: number[] }>();
  for (const entry of values) {
    const normalized = normalize(entry.value);
    if (!normalized) continue;
    const current = grouped.get(normalized);
    if (current) current.rowNumbers.push(entry.rowNumber);
    else grouped.set(normalized, { value: entry.value, rowNumbers: [entry.rowNumber] });
  }
  return [...grouped.entries()]
    .filter(([, entry]) => entry.rowNumbers.length > 1)
    .map(([normalizedValue, entry]) => ({ normalizedValue, ...entry }))
    .sort((left, right) => (left.rowNumbers[0] ?? 0) - (right.rowNumbers[0] ?? 0));
}

function quantityProblems(
  values: readonly { rowNumber: number; value: string }[],
  field: 'minimum_quantity' | 'opening_quantity',
): readonly LegacyQuantityProblem[] {
  return values.flatMap(({ rowNumber, value }) => {
    try {
      normalizeQuantity(value);
      return [];
    } catch (error) {
      return [
        {
          rowNumber,
          field,
          value,
          reason:
            error instanceof Error && error.message === 'NEGATIVE_QUANTITY'
              ? ('NEGATIVE' as const)
              : ('INVALID' as const),
        },
      ];
    }
  });
}

function transformationProposals(
  rows: readonly ParsedImportRow[],
  proposals: readonly LegacyColumnMappingProposal[],
  input: AnalyzeLegacyMigrationFileInput,
): readonly LegacyTransformationProposal[] {
  const transformations = new Map<string, LegacyTransformationProposal>();
  const add = (proposal: Omit<LegacyTransformationProposal, 'occurrences'>): void => {
    const key = `${proposal.field}\u0000${proposal.original}\u0000${proposal.destination ?? ''}`;
    const current = transformations.get(key);
    if (current) {
      transformations.set(key, { ...current, occurrences: current.occurrences + 1 });
    } else {
      transformations.set(key, { ...proposal, occurrences: 1 });
    }
  };

  const unitMapping = compileValueMapping(DEFAULT_VALUE_MAPPINGS.unit, input.valueMappings?.unit);
  const productTypeMapping = compileValueMapping(
    DEFAULT_VALUE_MAPPINGS.productType,
    input.valueMappings?.productType,
  );

  for (const field of [
    'sku',
    'name',
    'ean',
    'category',
    'opening_quantity',
    'minimum_quantity',
    'unit',
    'product_type',
  ] as const) {
    for (const { value } of fieldValues(rows, proposals, field)) {
      if (field === 'unit' || field === 'product_type') {
        const mapping = field === 'unit' ? unitMapping : productTypeMapping;
        const destination = mapping.get(normalizeMappingValue(value)) ?? null;
        if (!destination || destination !== value) {
          add({
            field,
            original: value,
            destination,
            status: destination ? 'PROPOSED' : 'REVIEW_REQUIRED',
            reason: destination
              ? 'ValueMapping conhecido; confirmar antes do dry-run.'
              : 'Valor externo sem ValueMapping; decisão humana obrigatória.',
          });
        }
        continue;
      }

      let destination: string | null;
      try {
        if (field === 'sku') destination = normalizeSku(value);
        else if (field === 'ean') destination = value.replaceAll(/\s/g, '');
        else if (field === 'opening_quantity' || field === 'minimum_quantity') {
          destination = normalizeQuantity(value);
        } else destination = normalizeText(value);
      } catch {
        destination = null;
      }
      if (destination !== value && destination !== null) {
        add({
          field,
          original: value,
          destination,
          status: 'PROPOSED',
          reason: 'Normalização canônica proposta; o valor original permanece preservado.',
        });
      }
    }
  }

  return [...transformations.values()].sort(
    (left, right) =>
      left.field.localeCompare(right.field) || left.original.localeCompare(right.original),
  );
}

function summarizeSource(
  table: ParsedTable,
  proposals: readonly LegacyColumnMappingProposal[],
): LegacySourceSummary {
  const nonEmptyRows = table.rows.filter(({ rawData }) =>
    Object.values(rawData).some((value) => normalizeText(value) !== null),
  );
  const skuColumn = selectedColumn(proposals, 'sku');
  const eanColumn = selectedColumn(proposals, 'ean');
  const categoryColumn = selectedColumn(proposals, 'category');
  const typeColumn = selectedColumn(proposals, 'product_type');
  const unitColumn = selectedColumn(proposals, 'unit');
  const openingQuantityColumn = selectedColumn(proposals, 'opening_quantity');
  const minimumQuantityColumn = selectedColumn(proposals, 'minimum_quantity');
  const skus = fieldValues(nonEmptyRows, proposals, 'sku');
  const eans = fieldValues(nonEmptyRows, proposals, 'ean').map(({ rowNumber, value }) => ({
    rowNumber,
    value: value.replaceAll(/\s/g, ''),
  }));
  const names = fieldValues(nonEmptyRows, proposals, 'name');
  const duplicateNames = duplicateValues(names, (value) => normalizeIdentity(value));
  const duplicateEans = duplicateValues(eans, (value) => value);
  const quantityIssues = [
    ...quantityProblems(
      fieldValues(nonEmptyRows, proposals, 'opening_quantity'),
      'opening_quantity',
    ),
    ...quantityProblems(
      fieldValues(nonEmptyRows, proposals, 'minimum_quantity'),
      'minimum_quantity',
    ),
  ];
  const hasQuantityColumn = openingQuantityColumn !== null || minimumQuantityColumn !== null;

  const duplicateProductCandidates: LegacyDuplicateProductCandidate[] = [
    ...duplicateNames.map(({ value, rowNumbers }) => ({
      reason: 'NORMALIZED_NAME' as const,
      value,
      rowNumbers,
    })),
    ...duplicateEans.map(({ value, rowNumbers }) => ({
      reason: 'DUPLICATE_EAN' as const,
      value,
      rowNumbers,
    })),
  ];

  return {
    totalProducts: nonEmptyRows.length,
    uniqueSkus: skuColumn
      ? new Set(skus.map(({ value }) => normalizeSku(value)).filter(Boolean)).size
      : null,
    duplicateSkus: skuColumn ? duplicateValues(skus, normalizeSku) : [],
    eans: eanColumn
      ? {
          informed: eans.length,
          unique: new Set(eans.map(({ value }) => value)).size,
          valid: eans.filter(({ value }) => isValidGtin(value)).length,
          invalid: eans.filter(({ value }) => !isValidGtin(value)),
        }
      : null,
    categories: categoryColumn
      ? frequency(fieldValues(nonEmptyRows, proposals, 'category').map(({ value }) => value))
      : null,
    productTypes: typeColumn
      ? frequency(fieldValues(nonEmptyRows, proposals, 'product_type').map(({ value }) => value))
      : null,
    units: unitColumn
      ? frequency(fieldValues(nonEmptyRows, proposals, 'unit').map(({ value }) => value))
      : null,
    productsWithoutCategory: categoryColumn
      ? nonEmptyRows.filter(({ rawData }) => normalizeText(rawData[categoryColumn]) === null).length
      : null,
    productsWithoutUnit: unitColumn
      ? nonEmptyRows.filter(({ rawData }) => normalizeText(rawData[unitColumn]) === null).length
      : null,
    invalidQuantities: hasQuantityColumn
      ? quantityIssues.filter(({ reason }) => reason === 'INVALID')
      : null,
    negativeQuantities: hasQuantityColumn
      ? quantityIssues.filter(({ reason }) => reason === 'NEGATIVE')
      : null,
    duplicateProductCandidates,
    unknownFields: proposals
      .filter(({ targetField, status }) => targetField === null || status === 'REVIEW_REQUIRED')
      .map(({ sourceColumn }) => sourceColumn),
  };
}

function sourceFindings(
  source: string,
  summary: LegacySourceSummary,
  proposals: readonly LegacyColumnMappingProposal[],
): readonly LegacyAnalysisFinding[] {
  const findings: LegacyAnalysisFinding[] = [];
  for (const column of summary.unknownFields) {
    findings.push({
      severity: 'WARNING',
      code: 'UNKNOWN_FIELD',
      source,
      field: column,
      problem: 'Campo sem mapeamento inequívoco.',
      suggestedAction: 'Mapear explicitamente para um campo canônico ou IGNORE.',
    });
  }
  for (const duplicate of summary.duplicateSkus) {
    findings.push({
      severity: 'ERROR',
      code: 'DUPLICATE_SKU',
      source,
      field: 'sku',
      value: duplicate.value,
      problem: `SKU repetido nas linhas ${duplicate.rowNumbers.join(', ')}.`,
      suggestedAction: 'Resolver o conflito antes do dry-run.',
    });
  }
  for (const invalid of summary.eans?.invalid ?? []) {
    findings.push({
      severity: 'ERROR',
      code: 'INVALID_EAN',
      source,
      field: 'ean',
      rowNumber: invalid.rowNumber,
      value: invalid.value,
      problem: 'EAN/GTIN inválido.',
      suggestedAction: 'Corrigir ou remover o EAN mediante decisão documentada.',
    });
  }
  for (const quantity of [
    ...(summary.invalidQuantities ?? []),
    ...(summary.negativeQuantities ?? []),
  ]) {
    findings.push({
      severity: 'ERROR',
      code: quantity.reason === 'NEGATIVE' ? 'NEGATIVE_QUANTITY' : 'INVALID_QUANTITY',
      source,
      field: quantity.field,
      rowNumber: quantity.rowNumber,
      value: quantity.value,
      problem:
        quantity.reason === 'NEGATIVE'
          ? 'Quantidade negativa não é permitida.'
          : 'Quantidade possui formato ou precisão inválida.',
      suggestedAction: 'Resolver o valor no arquivo de trabalho sem alterar o original preservado.',
    });
  }
  for (const proposal of proposals.filter(({ status }) => status === 'REVIEW_REQUIRED')) {
    if (proposal.targetField === null) continue;
    findings.push({
      severity: 'WARNING',
      code: 'AMBIGUOUS_COLUMN_MAPPING',
      source,
      field: proposal.sourceColumn,
      problem: proposal.reason,
      suggestedAction: 'Selecionar manualmente um único destino ou IGNORE.',
    });
  }
  if (selectedColumn(proposals, 'sku') === null || selectedColumn(proposals, 'name') === null) {
    findings.push({
      severity: 'WARNING',
      code: 'PRODUCT_TABLE_NOT_CONFIRMED',
      source,
      problem: 'A origem não possui SKU e nome mapeados de forma inequívoca.',
      suggestedAction: 'Confirmar o ColumnMapping antes de considerar as contagens definitivas.',
    });
  }
  return findings;
}

function analyzeParsedSource(
  source: ParsedSource,
  input: AnalyzeLegacyMigrationFileInput,
  distinctValueSampleLimit: number,
): LegacySourceAnalysis {
  const proposals = mappingProposals(source.table.headers, source.configuration.columnMapping);
  const summary = summarizeSource(source.table, proposals);
  const findings = sourceFindings(source.name, summary, proposals);
  const productTableCandidate =
    selectedColumn(proposals, 'sku') !== null && selectedColumn(proposals, 'name') !== null;
  return {
    name: source.name,
    position: source.position,
    status: source.table.rows.length === 0 ? 'EMPTY' : 'ANALYZED',
    headerRowNumber:
      typeof source.table.metadata.headerRowNumber === 'number'
        ? source.table.metadata.headerRowNumber
        : null,
    rowCount: source.table.rows.length,
    productTableCandidate,
    columns: profileColumns(source.table, distinctValueSampleLimit),
    columnMapping: proposals,
    transformations: transformationProposals(source.table.rows, proposals, input),
    summary,
    findings,
  };
}

function failedSource(name: string, position: number, error: unknown): LegacySourceAnalysis {
  const importError = error instanceof ImportFileError ? error : null;
  const empty = importError?.code === 'EMPTY_FILE' || importError?.code === 'EMPTY_HEADER';
  return {
    name,
    position,
    status: empty ? 'EMPTY' : 'ERROR',
    headerRowNumber: null,
    rowCount: 0,
    productTableCandidate: false,
    columns: [],
    columnMapping: [],
    transformations: [],
    summary: null,
    findings: [
      {
        severity: empty ? 'INFO' : 'ERROR',
        code: importError?.code ?? 'ANALYSIS_FAILED',
        source: name,
        problem: error instanceof Error ? error.message : 'Falha desconhecida durante a análise.',
        suggestedAction: empty
          ? 'Nenhuma ação necessária se a origem estiver intencionalmente vazia.'
          : 'Revisar o arquivo preservado; não avançar para staging.',
      },
    ],
  };
}

function validateSampleLimit(value: number | undefined): number {
  const resolved = value ?? 50;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 500) {
    throw new RangeError('distinctValueSampleLimit deve estar entre 1 e 500.');
  }
  return resolved;
}

export async function analyzeLegacyMigrationFile(
  input: AnalyzeLegacyMigrationFileInput,
): Promise<LegacyMigrationAnalysis> {
  const limits = resolveImportLimits(input.limits);
  const distinctValueSampleLimit = validateSampleLimit(input.distinctValueSampleLimit);
  if (!Number.isSafeInteger(input.file.size) || input.file.size <= 0) {
    throw new ImportFileError('EMPTY_FILE', 'O arquivo está vazio ou possui tamanho inválido.');
  }
  if (input.file.size > limits.maxFileSizeBytes) {
    throw new ImportFileError('FILE_TOO_LARGE', 'O arquivo excede o limite configurado.');
  }

  const format = detectFormat(input.file.name);
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  if (bytes.byteLength !== input.file.size) {
    throw new ImportFileError('INVALID_FILE_TYPE', 'O tamanho lido não corresponde ao arquivo.');
  }
  const sha256 = await calculateSha256(bytes);
  const availableSources =
    format === 'CSV' ? [{ name: 'CSV', position: 1 }] : listXlsxWorksheets(bytes, limits);
  if (format === 'XLSX' && input.parserOptions?.xlsx?.worksheetName) {
    throw new TypeError(
      'O ensaio inventaria todas as planilhas; configure cada uma por sourceConfigurations.',
    );
  }
  const availableSourceNames = new Set(availableSources.map(({ name }) => name));
  const unknownConfiguredSources = Object.keys(input.sourceConfigurations ?? {}).filter(
    (name) => !availableSourceNames.has(name),
  );
  if (unknownConfiguredSources.length > 0) {
    throw new ImportFileError(
      'INVALID_COLUMN_MAPPING',
      'A configuração referencia planilhas/tabelas inexistentes.',
      { unknownConfiguredSources },
    );
  }

  const sources = availableSources.map(({ name, position }): LegacySourceAnalysis => {
    const configuration = input.sourceConfigurations?.[name] ?? {};
    try {
      const table =
        format === 'CSV'
          ? parseCsv(bytes, limits, {
              ...input.parserOptions?.csv,
              ...(configuration.headerRowNumber
                ? { headerRowNumber: configuration.headerRowNumber }
                : {}),
            })
          : parseXlsx(bytes, limits, {
              worksheetName: name,
              ...(configuration.headerRowNumber
                ? { headerRowNumber: configuration.headerRowNumber }
                : input.parserOptions?.xlsx?.headerRowNumber
                  ? { headerRowNumber: input.parserOptions.xlsx.headerRowNumber }
                  : {}),
            });
      return analyzeParsedSource(
        { name, position, table, configuration },
        input,
        distinctValueSampleLimit,
      );
    } catch (error) {
      return failedSource(name, position, error);
    }
  });
  const allFindings = sources.flatMap(({ findings }) => findings);
  const analyzedAt = input.analyzedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(analyzedAt)))
    throw new TypeError('analyzedAt deve ser uma data válida.');

  return {
    reportSchemaVersion: 1,
    mode: 'READ_ONLY_LEGACY_ANALYSIS',
    analyzedAt,
    file: {
      originalFilename: input.file.name,
      sizeBytes: input.file.size,
      sha256,
      format,
    },
    availableSources,
    sources,
    totals: {
      sources: sources.length,
      analyzedSources: sources.filter(({ status }) => status === 'ANALYZED').length,
      rows: sources.reduce((total, source) => total + source.rowCount, 0),
      productCandidateRows: sources
        .filter(({ productTableCandidate }) => productTableCandidate)
        .reduce((total, source) => total + source.rowCount, 0),
      findings: allFindings.length,
      errors: allFindings.filter(({ severity }) => severity === 'ERROR').length,
      warnings: allFindings.filter(({ severity }) => severity === 'WARNING').length,
    },
    destructiveActionsExecuted: false,
    stagingExecuted: false,
    dryRunExecuted: false,
    confirmationPrepared: false,
  };
}
