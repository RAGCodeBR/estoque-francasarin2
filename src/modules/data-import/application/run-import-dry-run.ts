import { applyColumnMapping, validateColumnMapping } from '../domain/column-mapping';
import { ImportFileError } from '../domain/errors';
import {
  normalizeIdentity,
  normalizeMappedRow,
  normalizeSku,
  type NormalizationOptions,
} from '../domain/normalization';
import type {
  CategoryCandidate,
  ColumnMapping,
  ConflictResolution,
  DryRunAction,
  DryRunResult,
  DryRunRow,
  DryRunSummary,
  ExistingCategory,
  ExistingProduct,
  NormalizedImportData,
  ProductIdentityMatch,
  ProductMatchKind,
  ProductSuggestion,
  ValidationIssue,
  ValidationSeverity,
  ValidationState,
} from '../domain/types';
import { PRODUCT_MATCH_PRIORITY } from '../domain/types';
import type { CategoryLookup } from '../ports/category-lookup';
import type { ProductLookup } from '../ports/product-lookup';
import type { ImportStagingRepository } from '../ports/staging-repository';

export interface RunImportDryRunInput {
  batchId: string;
  mapping: readonly ColumnMapping[];
  repository: ImportStagingRepository;
  productLookup: ProductLookup;
  categoryLookup: CategoryLookup;
  normalization?: NormalizationOptions;
  resolutions?: readonly ConflictResolution[];
  approvedCategoryCreations?: readonly string[];
}

interface PreparedRow {
  rowNumber: number;
  rawData: DryRunRow['rawData'];
  normalizedData: NormalizedImportData;
  issues: ValidationIssue[];
  forcedIgnore: boolean;
  useExistingProductId?: string;
}

function createIssue(
  rowNumber: number,
  severity: ValidationSeverity,
  code: string,
  field: ValidationIssue['field'],
  value: string | null,
  problem: string,
  suggestedCorrection: string,
): ValidationIssue {
  return { rowNumber, severity, code, field, value, problem, suggestedCorrection };
}

function createSummary(rows: readonly DryRunRow[]): DryRunSummary {
  const actionCount = (action: DryRunAction) => rows.filter((row) => row.action === action).length;
  const NEW = actionCount('NEW');
  const UPDATE_CANDIDATE = actionCount('UPDATE_CANDIDATE');
  const INVALID = rows.filter((row) => row.state === 'ERROR').length;
  const CONFLICT = rows.filter((row) => row.state === 'CONFLICT').length;
  const IGNORED = rows.filter((row) => row.state === 'IGNORED').length;

  return {
    TOTAL: rows.length,
    VALID: NEW + UPDATE_CANDIDATE,
    INVALID,
    NEW,
    UPDATE_CANDIDATE,
    CONFLICT,
    IGNORED,
  };
}

function sameProductData(data: NormalizedImportData, existing: ExistingProduct): boolean {
  const hasOpeningQuantity = data.opening_quantity !== null && data.opening_quantity !== '0.000';
  const sameEan = data.ean === null || data.ean === (existing.ean ?? null);
  const sameMinimum =
    data.minimum_quantity === null ||
    data.minimum_quantity === (existing.minimumQuantity ?? '0.000');

  return (
    !hasOpeningQuantity &&
    sameEan &&
    sameMinimum &&
    data.sku !== null &&
    normalizeIdentity(data.sku) === normalizeIdentity(existing.sku) &&
    data.name !== null &&
    normalizeIdentity(data.name) === normalizeIdentity(existing.name) &&
    data.unit === existing.unit &&
    data.category !== null &&
    normalizeIdentity(data.category) === normalizeIdentity(existing.category) &&
    data.product_type === existing.productType
  );
}

function stateFromIssues(issues: readonly ValidationIssue[]): ValidationState {
  if (issues.some(({ severity }) => severity === 'CONFLICT')) return 'CONFLICT';
  if (issues.some(({ severity }) => severity === 'ERROR')) return 'ERROR';
  if (issues.some(({ severity }) => severity === 'WARNING')) return 'WARNING';
  return 'VALID';
}

function categoryResolution(
  row: PreparedRow,
  categoriesByName: ReadonlyMap<string, readonly ExistingCategory[]>,
  approvedCategoryCreations: ReadonlySet<string>,
): { issues: ValidationIssue[]; candidate?: CategoryCandidate } {
  const category = row.normalizedData.category;
  if (!category) return { issues: [] };
  const matches = categoriesByName.get(normalizeIdentity(category)) ?? [];

  if (matches.length === 0) {
    return {
      issues: [
        createIssue(
          row.rowNumber,
          'WARNING',
          'CATEGORY_CREATION_CANDIDATE',
          'category',
          category,
          'A categoria não existe e foi marcada como candidata à criação.',
          'Confirme a criação da categoria ou associe a uma categoria existente.',
        ),
      ],
      candidate: {
        normalizedName: category,
        sourceValue: category,
        approvedForCreation: approvedCategoryCreations.has(normalizeIdentity(category)),
      },
    };
  }

  if (matches.length > 1) {
    return {
      issues: [
        createIssue(
          row.rowNumber,
          'CONFLICT',
          'AMBIGUOUS_CATEGORY',
          'category',
          category,
          'Mais de uma categoria corresponde ao valor normalizado.',
          'Escolha explicitamente uma categoria antes da confirmação.',
        ),
      ],
    };
  }

  return { issues: [] };
}

function productSuggestions(
  rowNumber: number,
  suggestionsByRow: ReadonlyMap<number, readonly ProductSuggestion[]>,
): { suggestions: readonly ProductSuggestion[]; issues: readonly ValidationIssue[] } {
  const suggestions = suggestionsByRow.get(rowNumber) ?? [];
  if (suggestions.length === 0) return { suggestions, issues: [] };
  return {
    suggestions,
    issues: [
      createIssue(
        rowNumber,
        'WARNING',
        'SIMILAR_NAME_SUGGESTION',
        'name',
        null,
        'Há produtos com descrição semelhante, mas sem identificador inequívoco.',
        'Revise as sugestões; nunca haverá merge automático somente pelo nome.',
      ),
    ],
  };
}

function buildResultRow(
  prepared: PreparedRow,
  action: DryRunAction | null,
  issues: readonly ValidationIssue[],
  options: {
    resolvedEntityId?: string;
    categoryCandidate?: CategoryCandidate;
    suggestions?: readonly ProductSuggestion[];
    matchedBy?: ProductMatchKind;
  } = {},
): DryRunRow {
  const state = action === 'IGNORED' ? 'IGNORED' : stateFromIssues(issues);
  return {
    rowNumber: prepared.rowNumber,
    rawData: prepared.rawData,
    normalizedData: prepared.normalizedData,
    state,
    action: state === 'ERROR' ? null : state === 'CONFLICT' ? 'CONFLICT' : action,
    issues,
    ...(options.resolvedEntityId ? { resolvedEntityId: options.resolvedEntityId } : {}),
    ...(options.matchedBy ? { matchedBy: options.matchedBy } : {}),
    ...(options.categoryCandidate ? { categoryCandidate: options.categoryCandidate } : {}),
    ...(options.suggestions && options.suggestions.length > 0
      ? { suggestions: options.suggestions }
      : {}),
  };
}

function distinctProducts(matches: readonly ProductIdentityMatch[]): ExistingProduct[] {
  return [...new Map(matches.map(({ product }) => [product.id, product])).values()];
}

function orderMatches(matches: readonly ProductIdentityMatch[]): ProductIdentityMatch[] {
  return [...matches].sort(
    (left, right) =>
      PRODUCT_MATCH_PRIORITY.indexOf(left.matchedBy) -
      PRODUCT_MATCH_PRIORITY.indexOf(right.matchedBy),
  );
}

export async function runImportDryRun(input: RunImportDryRunInput): Promise<DryRunResult> {
  const batch = await input.repository.loadBatch(input.batchId);
  validateColumnMapping(batch.headers, input.mapping);

  const resolutionByRow = new Map<number, ConflictResolution>();
  const approvedCategoryCreations = new Set(
    (input.approvedCategoryCreations ?? []).map(normalizeIdentity),
  );
  for (const resolution of input.resolutions ?? []) {
    if (resolutionByRow.has(resolution.rowNumber)) {
      throw new ImportFileError(
        'INVALID_COLUMN_MAPPING',
        `Mais de uma resolução foi informada para a linha ${String(resolution.rowNumber)}.`,
      );
    }
    resolutionByRow.set(resolution.rowNumber, resolution);
  }

  const preparedRows: PreparedRow[] = batch.rows.map((row) => {
    const normalized = normalizeMappedRow(
      applyColumnMapping(row.rawData, input.mapping),
      row.rowNumber,
      input.normalization,
    );
    const resolution = resolutionByRow.get(row.rowNumber);
    const data = { ...normalized.data };
    const issues = [...normalized.issues];

    if (resolution?.decision === 'REPLACE_SKU') {
      data.sku = normalizeSku(resolution.replacementSku);
      if (!data.sku) {
        issues.push(
          createIssue(
            row.rowNumber,
            'CONFLICT',
            'INVALID_RESOLUTION',
            'sku',
            resolution.replacementSku,
            'O SKU substituto não pode ser vazio.',
            'Informe um SKU substituto não vazio e único.',
          ),
        );
      }
    }

    return {
      rowNumber: row.rowNumber,
      rawData: row.rawData,
      normalizedData: data,
      issues,
      forcedIgnore: normalized.ignored || resolution?.decision === 'IGNORE',
      ...(resolution?.decision === 'USE_EXISTING'
        ? { useExistingProductId: resolution.productId }
        : {}),
    };
  });

  const skuRows = new Map<string, PreparedRow[]>();
  for (const row of preparedRows) {
    if (row.forcedIgnore || row.issues.some(({ severity }) => severity === 'ERROR')) continue;
    const sku = row.normalizedData.sku;
    if (!sku) continue;
    const identity = normalizeIdentity(sku);
    skuRows.set(identity, [...(skuRows.get(identity) ?? []), row]);
  }
  const duplicatedSkus = new Set(
    [...skuRows.entries()].filter(([, rows]) => rows.length > 1).map(([sku]) => sku),
  );

  const eligibleRows = preparedRows.filter(
    (row) =>
      !row.forcedIgnore &&
      !row.issues.some(({ severity }) => severity === 'ERROR') &&
      row.normalizedData.sku !== null &&
      !duplicatedSkus.has(normalizeIdentity(row.normalizedData.sku)),
  );
  const categoryNames = [
    ...new Set(
      eligibleRows
        .map(({ normalizedData }) => normalizedData.category)
        .filter((name): name is string => name !== null),
    ),
  ];
  const identityQueries = eligibleRows.map(({ rowNumber, normalizedData }) => ({
    rowNumber,
    sourceSystem: batch.sourceName,
    externalId: normalizedData.external_id,
    sku: normalizedData.sku ?? '',
    ean: normalizedData.ean,
  }));
  const nameQueries = eligibleRows
    .filter(({ normalizedData }) => normalizedData.name !== null)
    .map(({ rowNumber, normalizedData }) => ({ rowNumber, name: normalizedData.name ?? '' }));

  const [categories, identityMatches, nameMatches] = await Promise.all([
    input.categoryLookup.findByNormalizedNames(categoryNames),
    input.productLookup.findIdentityMatches(identityQueries),
    input.productLookup.suggestBySimilarNames(nameQueries),
  ]);

  const categoriesByName = new Map<string, ExistingCategory[]>();
  for (const category of categories) {
    const identity = normalizeIdentity(category.name);
    categoriesByName.set(identity, [...(categoriesByName.get(identity) ?? []), category]);
  }
  const identityMatchesByRow = new Map<number, ProductIdentityMatch[]>();
  for (const match of identityMatches) {
    identityMatchesByRow.set(match.rowNumber, [
      ...(identityMatchesByRow.get(match.rowNumber) ?? []),
      match,
    ]);
  }
  const suggestionsByRow = new Map<number, ProductSuggestion[]>();
  for (const suggestion of nameMatches) {
    const mapped: ProductSuggestion = {
      productId: suggestion.product.id,
      sku: suggestion.product.sku,
      name: suggestion.product.name,
      reason: 'SIMILAR_NAME',
      ...(suggestion.confidence === undefined ? {} : { confidence: suggestion.confidence }),
    };
    suggestionsByRow.set(suggestion.rowNumber, [
      ...(suggestionsByRow.get(suggestion.rowNumber) ?? []),
      mapped,
    ]);
  }

  const resultRows = preparedRows.map((row): DryRunRow => {
    if (row.forcedIgnore) return buildResultRow(row, 'IGNORED', row.issues);
    if (row.issues.some(({ severity }) => severity === 'ERROR')) {
      return buildResultRow(row, null, row.issues);
    }

    const sku = row.normalizedData.sku;
    if (sku && duplicatedSkus.has(normalizeIdentity(sku))) {
      const issues = [
        ...row.issues,
        createIssue(
          row.rowNumber,
          'CONFLICT',
          'DUPLICATE_SKU_IN_FILE',
          'sku',
          sku,
          'O mesmo SKU aparece em mais de uma linha do arquivo.',
          'Mantenha um SKU único por produto ou substitua o SKU de uma das linhas.',
        ),
      ];
      return buildResultRow(row, 'CONFLICT', issues);
    }

    const category = categoryResolution(row, categoriesByName, approvedCategoryCreations);
    const matches = orderMatches(identityMatchesByRow.get(row.rowNumber) ?? []);
    const products = distinctProducts(matches);
    if (products.length > 1) {
      const issues = [
        ...row.issues,
        ...category.issues,
        createIssue(
          row.rowNumber,
          'CONFLICT',
          'CONTRADICTORY_PRODUCT_IDENTIFIERS',
          'row',
          null,
          'Os identificadores seguros da linha apontam para produtos diferentes.',
          'Resolva o conflito entre mapeamento externo, SKU, EAN e outros identificadores.',
        ),
      ];
      return buildResultRow(row, 'CONFLICT', issues, {
        ...(category.candidate ? { categoryCandidate: category.candidate } : {}),
      });
    }

    const existing = products[0];
    const matchedBy = matches[0]?.matchedBy;
    if (row.useExistingProductId && existing?.id !== row.useExistingProductId) {
      const issues = [
        ...row.issues,
        ...category.issues,
        createIssue(
          row.rowNumber,
          'CONFLICT',
          'INVALID_RESOLUTION',
          'row',
          row.useExistingProductId,
          'O produto escolhido não corresponde a nenhum identificador seguro da linha.',
          'Escolha um produto retornado pela identificação segura ou corrija os identificadores.',
        ),
      ];
      return buildResultRow(row, 'CONFLICT', issues, {
        ...(category.candidate ? { categoryCandidate: category.candidate } : {}),
      });
    }

    if (existing) {
      const issues = [...row.issues, ...category.issues];
      const action = sameProductData(row.normalizedData, existing) ? 'IGNORED' : 'UPDATE_CANDIDATE';
      return buildResultRow(row, action, issues, {
        resolvedEntityId: existing.id,
        ...(matchedBy ? { matchedBy } : {}),
        ...(category.candidate ? { categoryCandidate: category.candidate } : {}),
      });
    }

    const similar = productSuggestions(row.rowNumber, suggestionsByRow);
    const issues = [...row.issues, ...category.issues, ...similar.issues];
    return buildResultRow(row, 'NEW', issues, {
      ...(category.candidate ? { categoryCandidate: category.candidate } : {}),
      suggestions: similar.suggestions,
    });
  });

  const summary = createSummary(resultRows);
  const result = { batchId: input.batchId, summary, rows: resultRows };

  // O dry-run persiste somente análise no staging; nenhuma entidade oficial é escrita.
  await input.repository.saveDryRun(input.batchId, {
    mapping: input.mapping,
    valueMapping: input.normalization?.valueMappings ?? {},
    valueMappingVersion: 1,
    approvedCategoryCreations: [...approvedCategoryCreations],
    summary,
    rows: resultRows,
  });

  return result;
}
