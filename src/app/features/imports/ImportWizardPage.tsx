import { useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';

import {
  compileValueMapping,
  confirmProductImport,
  DEFAULT_VALUE_MAPPINGS,
  inspectProductImportFile,
  isProductImportConfirmable,
  normalizeMappingValue,
  prepareProductImport,
  serializeImportReport,
  SupabaseImportConfirmationRepository,
  SupabaseProductImportWizardRepository,
  type ColumnMapping,
  type ImportFileInspection,
  type ImportResultDetails,
  type ImportValueMappings,
  type PreparedProductImport,
  type ProductImportConflictResolution,
  type ProductImportMode,
  type ProductImportPreviewPage,
  type ProductImportPreviewRow,
} from '../../../modules/data-import';
import {
  LocationService,
  SupabaseLocationRepository,
  type Location,
} from '../../../modules/locations';
import { ProductService, SupabaseProductRepository, type Product } from '../../../modules/products';
import { EmptyState } from '../../components/feedback/EmptyState';
import { useToast } from '../../components/feedback/toast-context';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Icon } from '../../components/ui/Icon';
import { ImportStepper } from './ImportStepper';
import {
  categoryCandidates,
  dryRunCards,
  formatDuration,
  IMPORT_WIZARD_STEPS,
  TARGET_LABELS,
  targetsForMode,
} from './import-wizard-state';

type ValueChoice = '' | 'UN' | 'KG' | 'RAW' | 'FRACTIONATED';
type ConflictChoice = ProductImportConflictResolution;

const pageSize = 500;

function selectedProductId(choice: ConflictChoice | undefined): string | undefined {
  return choice?.decision === 'USE_EXISTING' ? choice.entityId : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function visibleError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Não foi possível concluir esta etapa.';
}

function defaultValueChoice(field: 'unit' | 'productType', sourceValue: string): ValueChoice {
  const defaults =
    field === 'unit' ? DEFAULT_VALUE_MAPPINGS.unit : DEFAULT_VALUE_MAPPINGS.productType;
  return compileValueMapping(defaults).get(normalizeMappingValue(sourceValue)) ?? '';
}

function mappingValues(
  inspection: ImportFileInspection,
  mapping: readonly ColumnMapping[],
  target: 'unit' | 'product_type',
): readonly string[] {
  const source = mapping.find(({ targetField }) => targetField === target)?.sourceColumn;
  return source ? (inspection.distinctValues[source] ?? []) : [];
}

function valueMappingsFromChoices(
  units: Readonly<Record<string, ValueChoice>>,
  productTypes: Readonly<Record<string, ValueChoice>>,
): Partial<ImportValueMappings> {
  return {
    unit: Object.entries(units)
      .filter((entry): entry is [string, 'UN' | 'KG'] => entry[1] === 'UN' || entry[1] === 'KG')
      .map(([sourceValue, targetValue]) => ({ sourceValue, targetValue })),
    productType: Object.entries(productTypes)
      .filter(
        (entry): entry is [string, 'RAW' | 'FRACTIONATED'] =>
          entry[1] === 'RAW' || entry[1] === 'FRACTIONATED',
      )
      .map(([sourceValue, targetValue]) => ({ sourceValue, targetValue })),
  };
}

async function loadCompletePreview(
  repository: SupabaseProductImportWizardRepository,
  batchId: string,
): Promise<ProductImportPreviewPage> {
  const first = await repository.getPreview(batchId, 1, pageSize);
  const pageCount = Math.ceil(first.totalRows / pageSize);
  if (pageCount <= 1) return first;
  const remaining = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      repository.getPreview(batchId, index + 2, pageSize),
    ),
  );
  return { ...first, rows: [...first.rows, ...remaining.flatMap((page) => page.rows)] };
}

function StepHeading({
  children,
  number,
  title,
}: {
  children: ReactNode;
  number: number;
  title: string;
}) {
  return (
    <header className="import-step-heading">
      <span>ETAPA {String(number).padStart(2, '0')}</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </header>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`summary-pill summary-pill--${tone}`}>
      <strong>{value.toLocaleString('pt-BR')}</strong>
      <span>{label}</span>
    </div>
  );
}

export function ImportWizardPage() {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<ProductImportMode>('INITIAL_MIGRATION');
  const [sourceName, setSourceName] = useState('Sistema legado');
  const [inspection, setInspection] = useState<ImportFileInspection | null>(null);
  const [mapping, setMapping] = useState<readonly ColumnMapping[]>([]);
  const [unitChoices, setUnitChoices] = useState<Readonly<Record<string, ValueChoice>>>({});
  const [productTypeChoices, setProductTypeChoices] = useState<
    Readonly<Record<string, ValueChoice>>
  >({});
  const [prepared, setPrepared] = useState<PreparedProductImport | null>(null);
  const [preview, setPreview] = useState<ProductImportPreviewPage | null>(null);
  const [approvedCategories, setApprovedCategories] = useState<readonly string[]>([]);
  const [conflictChoices, setConflictChoices] = useState<Readonly<Record<number, ConflictChoice>>>(
    {},
  );
  const [productSearch, setProductSearch] = useState<Readonly<Record<number, string>>>({});
  const [productResults, setProductResults] = useState<
    Readonly<Record<number, readonly Product[]>>
  >({});
  const [locations, setLocations] = useState<readonly Location[]>([]);
  const [stockLocationId, setStockLocationId] = useState('');
  const [existingStrategy, setExistingStrategy] = useState<'ASSOCIATE_ONLY' | 'UPDATE_MASTER_DATA'>(
    'ASSOCIATE_ONLY',
  );
  const [impactAccepted, setImpactAccepted] = useState(false);
  const [result, setResult] = useState<ImportResultDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wizardRepository = useMemo(() => new SupabaseProductImportWizardRepository(), []);
  const confirmationRepository = useMemo(() => new SupabaseImportConfirmationRepository(), []);
  const productService = useMemo(() => new ProductService(new SupabaseProductRepository()), []);
  const locationService = useMemo(() => new LocationService(new SupabaseLocationRepository()), []);
  const { notify } = useToast();

  const stepMeta = IMPORT_WIZARD_STEPS[step - 1];
  const unitValues = inspection ? mappingValues(inspection, mapping, 'unit') : [];
  const productTypeValues = inspection ? mappingValues(inspection, mapping, 'product_type') : [];
  const valueMappings = valueMappingsFromChoices(unitChoices, productTypeChoices);
  const conflicts = preview?.rows.filter(({ state }) => state === 'CONFLICT') ?? [];
  const categories = preview ? categoryCandidates(preview.rows) : [];
  const hasOpeningQuantity =
    mode === 'INITIAL_MIGRATION' &&
    mapping.some(({ targetField }) => targetField === 'opening_quantity') &&
    Boolean(prepared?.rows.some(({ normalizedData }) => normalizedData.opening_quantity !== null));
  const previewErrors = preview
    ? Math.max(0, preview.summary.INVALID - preview.summary.CONFLICT)
    : 0;

  const resetAnalysis = () => {
    setPrepared(null);
    setPreview(null);
    setApprovedCategories([]);
    setConflictChoices({});
    setProductResults({});
    setStockLocationId('');
    setImpactAccepted(false);
    setResult(null);
  };

  const handleModeChange = (nextMode: ProductImportMode) => {
    setMode(nextMode);
    setMapping((current) =>
      current.map((entry) =>
        nextMode === 'MASTER_DATA_IMPORT' && entry.targetField === 'opening_quantity'
          ? { ...entry, targetField: 'IGNORE' }
          : entry,
      ),
    );
    resetAnalysis();
  };

  const inspectFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const nextInspection = await inspectProductImportFile({ file });
      setInspection(nextInspection);
      setMapping(
        nextInspection.headers.map((sourceColumn) => ({ sourceColumn, targetField: 'IGNORE' })),
      );
      setUnitChoices({});
      setProductTypeChoices({});
      resetAnalysis();
    } catch (caught) {
      setInspection(null);
      setMapping([]);
      setError(visibleError(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void inspectFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void inspectFile(file);
  };

  const updateColumnMapping = (sourceColumn: string, targetField: ColumnMapping['targetField']) => {
    setMapping((current) =>
      current.map((entry) =>
        entry.sourceColumn === sourceColumn ? { ...entry, targetField } : entry,
      ),
    );
    resetAnalysis();
  };

  const initializeValueChoices = () => {
    setUnitChoices((current) => ({
      ...Object.fromEntries(unitValues.map((value) => [value, defaultValueChoice('unit', value)])),
      ...current,
    }));
    setProductTypeChoices((current) => ({
      ...Object.fromEntries(
        productTypeValues.map((value) => [value, defaultValueChoice('productType', value)]),
      ),
      ...current,
    }));
  };

  const runLocalValidation = () => {
    if (!inspection) return;
    setError(null);
    try {
      const next = prepareProductImport({ mode, inspection, mapping, valueMappings });
      setPrepared(next);
      setStep(5);
    } catch (caught) {
      setError(visibleError(caught));
    }
  };

  const executeDryRun = async () => {
    if (!inspection || !prepared) return;
    setBusy(true);
    setError(null);
    try {
      const staged = await wizardRepository.stagePreview({
        mode,
        sourceType: inspection.format,
        sourceName,
        originalFilename: inspection.file.name,
        fileHash: inspection.fileHash,
        fileSizeBytes: inspection.file.size,
        detectedHeaders: inspection.headers,
        columnMapping: mapping,
        valueMappings,
        rows: prepared.rows,
      });
      const nextPreview = await loadCompletePreview(wizardRepository, staged.batchId);
      setPreview(nextPreview);
      setStep(7);
      notify({
        title: 'Dry-run concluído',
        description: `${nextPreview.summary.TOTAL.toLocaleString('pt-BR')} linhas analisadas sem gravar produtos.`,
        tone: 'success',
      });
    } catch (caught) {
      setError(visibleError(caught));
    } finally {
      setBusy(false);
    }
  };

  const loadLocations = async () => {
    if (!hasOpeningQuantity) return;
    const page = await locationService.search({
      locationType: 'STOCK',
      isActive: true,
      page: 1,
      pageSize: 100,
    });
    setLocations(page.items);
    if (page.items.length === 1) setStockLocationId(page.items[0]?.id ?? '');
  };

  const continueAfterDryRun = async () => {
    if (!preview) return;
    setError(null);
    if (previewErrors > 0) {
      setStep(4);
      setError('Corrija os valores ou o arquivo e execute um novo dry-run antes de continuar.');
      return;
    }
    if (preview.summary.CONFLICT > 0 || categories.length > 0) {
      setStep(8);
      return;
    }
    setBusy(true);
    try {
      await loadLocations();
      setStep(9);
    } catch (caught) {
      setError(visibleError(caught));
    } finally {
      setBusy(false);
    }
  };

  const searchProducts = async (row: ProductImportPreviewRow) => {
    const query = productSearch[row.rowNumber]?.trim();
    if (!query) return;
    setBusy(true);
    setError(null);
    try {
      const page = await productService.search({
        search: query,
        isActive: true,
        page: 1,
        pageSize: 5,
      });
      setProductResults((current) => ({ ...current, [row.rowNumber]: page.items }));
    } catch (caught) {
      setError(visibleError(caught));
    } finally {
      setBusy(false);
    }
  };

  const applyResolutions = async () => {
    if (!preview) return;
    const unresolved = conflicts.filter((row) => !conflictChoices[row.rowNumber]);
    const pendingCategories = categories.filter(
      (category) => !approvedCategories.includes(category),
    );
    if (unresolved.length > 0 || pendingCategories.length > 0) {
      setError('Resolva todos os conflitos e decida sobre todas as categorias antes de continuar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await wizardRepository.resolve(
        preview.batchId,
        Object.values(conflictChoices),
        approvedCategories,
      );
      const resolved = await loadCompletePreview(wizardRepository, preview.batchId);
      setPreview(resolved);
      if (!isProductImportConfirmable(resolved.summary) || resolved.status !== 'READY') {
        setError('Ainda existem pendências após a resolução. Revise as linhas novamente.');
        return;
      }
      await loadLocations();
      setStep(9);
    } catch (caught) {
      setError(visibleError(caught));
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!preview || !inspection || !impactAccepted) return;
    if (!isProductImportConfirmable(preview.summary) || preview.status !== 'READY') {
      setError('A confirmação permanece bloqueada por erros ou conflitos críticos.');
      return;
    }
    if (hasOpeningQuantity && !stockLocationId) {
      setError('Selecione o local central para registrar os saldos iniciais.');
      return;
    }

    setBusy(true);
    setError(null);
    const started = new Date();
    const startedAt = started.toISOString();
    try {
      const report = await confirmProductImport({
        repository: confirmationRepository,
        batchId: preview.batchId,
        mode,
        existingProductStrategy: existingStrategy,
        ...(hasOpeningQuantity ? { stockLocationId } : {}),
      });
      const finished = new Date();
      setResult({
        report,
        startedAt,
        finishedAt: finished.toISOString(),
        elapsedMilliseconds: finished.getTime() - started.getTime(),
        filename: inspection.file.name,
        sourceName,
      });
      setStep(10);
      notify({
        title: 'Importação concluída',
        description: `Lote ${report.batchId} finalizado com rastreabilidade.`,
        tone: 'success',
      });
    } catch (caught) {
      setError(visibleError(caught));
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    if (!result) return;
    const blob = new Blob([serializeImportReport(result)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `relatorio-importacao-${result.report.batchId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const resetWizard = () => {
    setStep(1);
    setInspection(null);
    setMapping([]);
    setUnitChoices({});
    setProductTypeChoices({});
    resetAnalysis();
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const back = () => {
    setError(null);
    setStep((current) => Math.max(1, current - 1));
  };

  const renderStep = () => {
    if (step === 1) {
      return (
        <>
          <StepHeading number={1} title="Selecione o arquivo e o tipo de importação">
            O arquivo será lido e validado no navegador antes de qualquer staging. Formatos aceitos:
            CSV e XLSX.
          </StepHeading>
          <div className="import-mode-grid">
            <label className={mode === 'INITIAL_MIGRATION' ? 'is-selected' : ''}>
              <input
                checked={mode === 'INITIAL_MIGRATION'}
                name="import-mode"
                onChange={() => {
                  handleModeChange('INITIAL_MIGRATION');
                }}
                type="radio"
              />
              <span className="import-mode-card__icon">
                <Icon name="history" />
              </span>
              <strong>Migração inicial</strong>
              <small>Produtos, categorias e saldo legado por movimentação de abertura.</small>
            </label>
            <label className={mode === 'MASTER_DATA_IMPORT' ? 'is-selected' : ''}>
              <input
                checked={mode === 'MASTER_DATA_IMPORT'}
                name="import-mode"
                onChange={() => {
                  handleModeChange('MASTER_DATA_IMPORT');
                }}
                type="radio"
              />
              <span className="import-mode-card__icon">
                <Icon name="package" />
              </span>
              <strong>Importação de cadastro</strong>
              <small>Dados mestres sem sobrescrever ou reconciliar o saldo atual.</small>
            </label>
          </div>
          <FormField
            label="Origem dos dados"
            onChange={(event) => {
              setSourceName(event.target.value);
            }}
            placeholder="Ex.: Sistema legado do restaurante"
            value={sourceName}
          />
          <div
            className={`file-dropzone ${inspection ? 'file-dropzone--selected' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={handleDrop}
          >
            <input
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Selecionar arquivo CSV ou XLSX"
              onChange={handleFileInput}
              ref={fileInputRef}
              type="file"
            />
            <span className="file-dropzone__icon">
              <Icon name={inspection ? 'check' : 'upload'} size={25} />
            </span>
            {inspection ? (
              <>
                <strong>{inspection.file.name}</strong>
                <p>
                  {inspection.format} · {formatBytes(inspection.file.size)} ·{' '}
                  {inspection.rows.length.toLocaleString('pt-BR')} linhas
                </p>
                <button onClick={() => fileInputRef.current?.click()} type="button">
                  Trocar arquivo
                </button>
              </>
            ) : (
              <>
                <strong>Arraste o arquivo para esta área</strong>
                <p>ou clique para selecionar · máximo de 10 MB</p>
                <button onClick={() => fileInputRef.current?.click()} type="button">
                  Selecionar arquivo
                </button>
              </>
            )}
          </div>
        </>
      );
    }

    if (step === 2 && inspection) {
      return (
        <>
          <StepHeading number={2} title="Colunas identificadas no arquivo">
            Confira os cabeçalhos detectados. Nenhum nome é presumido como campo do sistema.
          </StepHeading>
          <div className="detected-summary">
            <div>
              <span>Formato</span>
              <strong>{inspection.format}</strong>
            </div>
            <div>
              <span>Colunas</span>
              <strong>{inspection.headers.length}</strong>
            </div>
            <div>
              <span>Linhas</span>
              <strong>{inspection.rows.length.toLocaleString('pt-BR')}</strong>
            </div>
            <div>
              <span>Arquivo</span>
              <strong>{formatBytes(inspection.file.size)}</strong>
            </div>
          </div>
          <div className="detected-columns">
            {inspection.headers.map((header, index) => (
              <div key={header}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{header}</strong>
                <small>
                  {(inspection.distinctValues[header]?.length ?? 0).toLocaleString('pt-BR')} valores
                  distintos
                </small>
              </div>
            ))}
          </div>
        </>
      );
    }

    if (step === 3 && inspection) {
      const targets = targetsForMode(mode);
      return (
        <>
          <StepHeading number={3} title="Associe cada coluna ao campo correto">
            Toda coluna deve receber um destino ou ser explicitamente ignorada. Campos obrigatórios:
            SKU, produto, unidade, categoria e tipo.
          </StepHeading>
          <div className="mapping-table">
            <div className="mapping-table__header">
              <span>Coluna original</span>
              <span>Campo do sistema</span>
              <span>Amostra</span>
            </div>
            {mapping.map((entry) => (
              <div className="mapping-table__row" key={entry.sourceColumn}>
                <strong>{entry.sourceColumn}</strong>
                <select
                  aria-label={`Destino para ${entry.sourceColumn}`}
                  onChange={(event) => {
                    updateColumnMapping(
                      entry.sourceColumn,
                      event.target.value as ColumnMapping['targetField'],
                    );
                  }}
                  value={entry.targetField}
                >
                  {targets.map((target) => {
                    const used =
                      target !== 'IGNORE' &&
                      mapping.some(
                        (other) =>
                          other.sourceColumn !== entry.sourceColumn && other.targetField === target,
                      );
                    return (
                      <option disabled={used} key={target} value={target}>
                        {TARGET_LABELS[target]}
                      </option>
                    );
                  })}
                </select>
                <small>{inspection.sampleRows[0]?.rawData[entry.sourceColumn] ?? '—'}</small>
              </div>
            ))}
          </div>
          {mode === 'MASTER_DATA_IMPORT' ? (
            <div className="import-inline-notice">
              <Icon name="warning" />
              <span>
                <strong>Saldo atual protegido</strong>Quantidade externa deve ser ignorada aqui e
                tratada no fluxo separado de reconciliação.
              </span>
            </div>
          ) : null}
        </>
      );
    }

    if (step === 4) {
      return (
        <>
          <StepHeading number={4} title="Normalize os valores externos">
            Associe variações encontradas no arquivo aos valores oficiais. Valores conhecidos já vêm
            sugeridos e podem ser alterados.
          </StepHeading>
          <div className="value-mapping-grid">
            <section>
              <div className="value-mapping__title">
                <span className="import-icon-box">
                  <Icon name="inventory" />
                </span>
                <div>
                  <strong>Unidades</strong>
                  <small>Destino: UN ou KG</small>
                </div>
              </div>
              {unitValues.length > 0 ? (
                unitValues.map((value) => (
                  <label className="value-mapping-row" key={value}>
                    <span>{value}</span>
                    <span>→</span>
                    <select
                      aria-label={`Mapear unidade ${value}`}
                      onChange={(event) => {
                        setUnitChoices((current) => ({
                          ...current,
                          [value]: event.target.value as ValueChoice,
                        }));
                        resetAnalysis();
                      }}
                      value={unitChoices[value] ?? ''}
                    >
                      <option value="">Não reconhecido</option>
                      <option value="UN">UN</option>
                      <option value="KG">KG</option>
                    </select>
                  </label>
                ))
              ) : (
                <EmptyState
                  compact
                  description="Mapeie uma coluna para Unidade na etapa anterior."
                  title="Nenhuma unidade encontrada"
                />
              )}
            </section>
            <section>
              <div className="value-mapping__title">
                <span className="import-icon-box">
                  <Icon name="category" />
                </span>
                <div>
                  <strong>Tipos de produto</strong>
                  <small>Destino: RAW ou FRACTIONATED</small>
                </div>
              </div>
              {productTypeValues.length > 0 ? (
                productTypeValues.map((value) => (
                  <label className="value-mapping-row" key={value}>
                    <span>{value}</span>
                    <span>→</span>
                    <select
                      aria-label={`Mapear tipo ${value}`}
                      onChange={(event) => {
                        setProductTypeChoices((current) => ({
                          ...current,
                          [value]: event.target.value as ValueChoice,
                        }));
                        resetAnalysis();
                      }}
                      value={productTypeChoices[value] ?? ''}
                    >
                      <option value="">Não reconhecido</option>
                      <option value="RAW">RAW</option>
                      <option value="FRACTIONATED">FRACTIONATED</option>
                    </select>
                  </label>
                ))
              ) : (
                <EmptyState
                  compact
                  description="Mapeie uma coluna para Tipo de produto na etapa anterior."
                  title="Nenhum tipo encontrado"
                />
              )}
            </section>
          </div>
        </>
      );
    }

    if (step === 5 && prepared) {
      const summary = prepared.summary;
      const issueRows = prepared.rows
        .filter(({ validationErrors }) => validationErrors.length > 0)
        .slice(0, 50);
      return (
        <>
          <StepHeading number={5} title="Resultado da validação local">
            Valores foram normalizados sem gravar dados. Erros permanecem visíveis por linha, campo,
            valor e correção sugerida.
          </StepHeading>
          <div className="validation-summary">
            <SummaryPill label="Válidos" tone="success" value={summary.valid} />
            <SummaryPill label="Warnings" tone="warning" value={summary.warnings} />
            <SummaryPill label="Erros" tone="danger" value={summary.errors} />
            <SummaryPill label="Conflitos" tone="warning" value={summary.conflicts} />
            <SummaryPill label="Ignorados" tone="neutral" value={summary.ignored} />
          </div>
          {issueRows.length > 0 ? (
            <div className="issue-list">
              {issueRows.flatMap((row) =>
                row.validationErrors.map((issue, index) => (
                  <article key={`${String(row.rowNumber)}-${issue.code}-${String(index)}`}>
                    <span className="state-badge state-badge--error">Linha {row.rowNumber}</span>
                    <div>
                      <strong>{issue.problem}</strong>
                      <p>
                        <b>{issue.field}</b> · {issue.value ?? 'vazio'}
                      </p>
                      <small>{issue.suggestedCorrection}</small>
                    </div>
                  </article>
                )),
              )}
            </div>
          ) : (
            <div className="validation-success">
              <Icon name="check" size={26} />
              <div>
                <strong>Validação local concluída</strong>
                <p>
                  O banco ainda verificará categorias, produtos existentes, duplicidades e conflitos
                  no dry-run.
                </p>
              </div>
            </div>
          )}
        </>
      );
    }

    if (step === 6 && prepared) {
      return (
        <>
          <StepHeading number={6} title="Revise exemplos antes do dry-run">
            Esta amostra mostra os dados já normalizados. O staging receberá todas as linhas do
            arquivo.
          </StepHeading>
          <div className="preview-table-wrap">
            <table className="import-preview-table">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th>Unidade</th>
                  <th>Tipo</th>
                  <th>Quantidade</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {prepared.rows.slice(0, 12).map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>{row.normalizedData.sku ?? '—'}</td>
                    <td>{row.normalizedData.name ?? '—'}</td>
                    <td>{row.normalizedData.category ?? '—'}</td>
                    <td>{row.normalizedData.unit ?? '—'}</td>
                    <td>{row.normalizedData.product_type ?? '—'}</td>
                    <td>{row.normalizedData.opening_quantity ?? '—'}</td>
                    <td>
                      <span
                        className={`state-badge ${row.validationErrors.length > 0 ? 'state-badge--error' : 'state-badge--valid'}`}
                      >
                        {row.validationErrors.length > 0
                          ? 'ERRO'
                          : row.ignored
                            ? 'IGNORADO'
                            : 'VÁLIDO'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="preview-caption">
            Exibindo {Math.min(12, prepared.rows.length)} de{' '}
            {prepared.rows.length.toLocaleString('pt-BR')} linhas.
          </p>
        </>
      );
    }

    if (step === 7 && preview) {
      return (
        <>
          <StepHeading number={7} title="Impacto calculado pelo dry-run">
            A análise abaixo veio do staging e do banco. Nenhum produto, categoria ou saldo oficial
            foi alterado.
          </StepHeading>
          <div className="dry-run-grid">
            {dryRunCards(preview.summary).map((card) => (
              <SummaryPill key={card.label} {...card} />
            ))}
          </div>
          <div
            className={`dry-run-status ${isProductImportConfirmable(preview.summary) ? 'dry-run-status--ready' : 'dry-run-status--blocked'}`}
          >
            <Icon
              name={isProductImportConfirmable(preview.summary) ? 'check' : 'warning'}
              size={23}
            />
            <div>
              <strong>
                {isProductImportConfirmable(preview.summary)
                  ? 'Dry-run sem erros críticos'
                  : 'Confirmação bloqueada'}
              </strong>
              <p>
                {isProductImportConfirmable(preview.summary)
                  ? 'Revise categorias e warnings antes de confirmar.'
                  : 'Erros precisam ser corrigidos e conflitos precisam de uma decisão explícita.'}
              </p>
            </div>
            <code>{preview.batchId}</code>
          </div>
        </>
      );
    }

    if (step === 8 && preview) {
      return (
        <>
          <StepHeading number={8} title="Resolva todas as pendências">
            Associações por nome nunca são automáticas. Para cada conflito, escolha um produto
            existente ou ignore explicitamente a linha.
          </StepHeading>
          {categories.length > 0 ? (
            <section className="resolution-section">
              <div className="resolution-section__heading">
                <div>
                  <span className="import-icon-box">
                    <Icon name="category" />
                  </span>
                  <div>
                    <h3>Categorias candidatas</h3>
                    <p>Aprovação criará as categorias na confirmação transacional.</p>
                  </div>
                </div>
                <strong>{categories.length}</strong>
              </div>
              <div className="category-approval-list">
                {categories.map((category) => (
                  <label key={category}>
                    <input
                      checked={approvedCategories.includes(category)}
                      onChange={(event) => {
                        setApprovedCategories((current) =>
                          event.target.checked
                            ? [...current, category]
                            : current.filter((item) => item !== category),
                        );
                      }}
                      type="checkbox"
                    />
                    <span>
                      <strong>{category}</strong>
                      <small>Autorizar criação</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ) : null}
          {conflicts.length > 0 ? (
            <section className="resolution-section">
              <div className="resolution-section__heading">
                <div>
                  <span className="import-icon-box import-icon-box--warning">
                    <Icon name="warning" />
                  </span>
                  <div>
                    <h3>Conflitos críticos</h3>
                    <p>Todas as linhas abaixo exigem uma decisão.</p>
                  </div>
                </div>
                <strong>{conflicts.length}</strong>
              </div>
              <div className="conflict-list">
                {conflicts.map((row) => (
                  <article key={row.rowNumber}>
                    <div className="conflict-card__summary">
                      <span className="state-badge state-badge--conflict">
                        Linha {row.rowNumber}
                      </span>
                      <div>
                        <strong>{row.normalizedData?.name ?? 'Produto sem nome'}</strong>
                        <small>
                          SKU {row.normalizedData?.sku ?? '—'} · EAN{' '}
                          {row.normalizedData?.ean ?? '—'}
                        </small>
                      </div>
                    </div>
                    <p>{row.issues[0]?.problem ?? 'Identificadores conflitantes.'}</p>
                    <div className="conflict-actions">
                      <button
                        className={
                          conflictChoices[row.rowNumber]?.decision === 'IGNORE' ? 'is-selected' : ''
                        }
                        onClick={() => {
                          setConflictChoices((current) => ({
                            ...current,
                            [row.rowNumber]: { rowNumber: row.rowNumber, decision: 'IGNORE' },
                          }));
                        }}
                        type="button"
                      >
                        Ignorar linha
                      </button>
                      <div className="product-resolution-search">
                        <input
                          aria-label={`Buscar produto para linha ${String(row.rowNumber)}`}
                          onChange={(event) => {
                            setProductSearch((current) => ({
                              ...current,
                              [row.rowNumber]: event.target.value,
                            }));
                          }}
                          placeholder="Buscar produto por SKU ou nome"
                          value={productSearch[row.rowNumber] ?? ''}
                        />
                        <button
                          onClick={() => {
                            void searchProducts(row);
                          }}
                          type="button"
                        >
                          <Icon name="search" size={17} /> Buscar
                        </button>
                      </div>
                    </div>
                    {(productResults[row.rowNumber]?.length ?? 0) > 0 ? (
                      <div className="product-search-results">
                        {productResults[row.rowNumber]?.map((product) => (
                          <label
                            className={
                              selectedProductId(conflictChoices[row.rowNumber]) === product.id
                                ? 'is-selected'
                                : ''
                            }
                            key={product.id}
                          >
                            <input
                              checked={
                                selectedProductId(conflictChoices[row.rowNumber]) === product.id
                              }
                              name={`conflict-${String(row.rowNumber)}`}
                              onChange={() => {
                                setConflictChoices((current) => ({
                                  ...current,
                                  [row.rowNumber]: {
                                    rowNumber: row.rowNumber,
                                    decision: 'USE_EXISTING',
                                    entityId: product.id,
                                  },
                                }));
                              }}
                              type="radio"
                            />
                            <span>
                              <strong>{product.name}</strong>
                              <small>
                                {product.sku} · {product.unit}
                              </small>
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      );
    }

    if (step === 9 && preview) {
      return (
        <>
          <StepHeading number={9} title="Confirme o impacto da importação">
            Esta é a última etapa antes da gravação oficial. A operação será transacional, auditada
            e idempotente por lote.
          </StepHeading>
          <div className="confirmation-impact">
            <span>
              <Icon name="warning" size={25} />
            </span>
            <div>
              <strong>
                {mode === 'INITIAL_MIGRATION'
                  ? 'Migração inicial do sistema legado'
                  : 'Importação de dados mestres'}
              </strong>
              <p>
                {mode === 'INITIAL_MIGRATION'
                  ? 'Produtos e categorias serão promovidos. Quantidades gerarão MIGRATION_OPENING_BALANCE e nunca UPDATE direto no saldo.'
                  : 'Produtos poderão ser associados ou atualizados conforme a estratégia. Nenhuma quantidade atual será alterada.'}
              </p>
            </div>
          </div>
          <div className="confirmation-options">
            <label>
              <span>Produtos existentes</span>
              <select
                onChange={(event) => {
                  setExistingStrategy(event.target.value as typeof existingStrategy);
                }}
                value={existingStrategy}
              >
                <option value="ASSOCIATE_ONLY">Somente associar</option>
                <option value="UPDATE_MASTER_DATA">Atualizar dados mestres</option>
              </select>
              <small>Nomes parecidos continuam sem merge automático.</small>
            </label>
            {hasOpeningQuantity ? (
              <label>
                <span>Local do saldo inicial</span>
                <select
                  onChange={(event) => {
                    setStockLocationId(event.target.value);
                  }}
                  value={stockLocationId}
                >
                  <option value="">Selecione o estoque central</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                <small>As movimentações de abertura serão vinculadas a este local.</small>
              </label>
            ) : null}
          </div>
          <div className="confirmation-recap">
            <div>
              <span>Novos</span>
              <strong>{preview.summary.NEW}</strong>
            </div>
            <div>
              <span>Existentes</span>
              <strong>{preview.summary.UPDATE_CANDIDATE}</strong>
            </div>
            <div>
              <span>Categorias</span>
              <strong>{preview.summary.CATEGORIES_NEW}</strong>
            </div>
            <div>
              <span>Ignorados</span>
              <strong>{preview.summary.IGNORED}</strong>
            </div>
          </div>
          <label className="impact-checkbox">
            <input
              checked={impactAccepted}
              onChange={(event) => {
                setImpactAccepted(event.target.checked);
              }}
              type="checkbox"
            />
            <span>
              <strong>Compreendo e autorizo este impacto</strong>
              <small>Confirmo que revisei o dry-run, as categorias e todas as resoluções.</small>
            </span>
          </label>
        </>
      );
    }

    if (step === 10 && result) {
      const report = result.report;
      const imported = report.productsCreated + report.productsAssociated + report.productsUpdated;
      return (
        <>
          <div className="import-result-hero">
            <span>
              <Icon name="check" size={30} />
            </span>
            <small>IMPORTAÇÃO CONCLUÍDA</small>
            <h2>Dados processados com rastreabilidade</h2>
            <p>O lote foi confirmado pelo backend e o relatório está pronto para download.</p>
          </div>
          <div className="result-grid">
            <SummaryPill label="Importados" tone="success" value={imported} />
            <SummaryPill label="Ignorados" tone="neutral" value={report.linesIgnored} />
            <SummaryPill label="Falhas" tone="danger" value={report.errors} />
            <SummaryPill label="Movimentações" tone="brown" value={report.movementsCreated} />
            <SummaryPill label="Categorias" tone="brown" value={report.categoriesCreated} />
          </div>
          <dl className="result-details">
            <div>
              <dt>Batch</dt>
              <dd>
                <code>{report.batchId}</code>
              </dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>{new Date(result.finishedAt).toLocaleString('pt-BR')}</dd>
            </div>
            <div>
              <dt>Duração</dt>
              <dd>{formatDuration(result.elapsedMilliseconds)}</dd>
            </div>
            <div>
              <dt>Arquivo</dt>
              <dd>{result.filename}</dd>
            </div>
            <div>
              <dt>Origem</dt>
              <dd>{result.sourceName}</dd>
            </div>
            <div>
              <dt>Modo</dt>
              <dd>{report.importMode}</dd>
            </div>
          </dl>
        </>
      );
    }

    return (
      <EmptyState
        description="Volte à primeira etapa e selecione um arquivo válido."
        title="Etapa sem dados"
      />
    );
  };

  const primaryAction = () => {
    if (step === 1)
      return (
        <Button
          disabled={!inspection || !sourceName.trim()}
          onClick={() => {
            setStep(2);
          }}
        >
          Continuar <span aria-hidden="true">→</span>
        </Button>
      );
    if (step === 2)
      return (
        <Button
          onClick={() => {
            setStep(3);
          }}
        >
          Mapear colunas <span aria-hidden="true">→</span>
        </Button>
      );
    if (step === 3)
      return (
        <Button
          onClick={() => {
            initializeValueChoices();
            setStep(4);
          }}
        >
          Mapear valores <span aria-hidden="true">→</span>
        </Button>
      );
    if (step === 4)
      return (
        <Button onClick={runLocalValidation}>
          Validar dados <span aria-hidden="true">→</span>
        </Button>
      );
    if (step === 5)
      return (
        <Button
          onClick={() => {
            setStep(6);
          }}
        >
          Abrir preview <span aria-hidden="true">→</span>
        </Button>
      );
    if (step === 6)
      return (
        <Button
          isLoading={busy}
          onClick={() => {
            void executeDryRun();
          }}
        >
          <Icon name="adjustments" size={18} /> Executar dry-run
        </Button>
      );
    if (step === 7)
      return (
        <Button
          isLoading={busy}
          onClick={() => {
            void continueAfterDryRun();
          }}
        >
          {previewErrors > 0
            ? 'Corrigir erros'
            : conflicts.length > 0 || categories.length > 0
              ? 'Resolver pendências'
              : 'Revisar confirmação'}{' '}
          <span aria-hidden="true">→</span>
        </Button>
      );
    if (step === 8)
      return (
        <Button
          isLoading={busy}
          onClick={() => {
            void applyResolutions();
          }}
        >
          Aplicar resoluções <span aria-hidden="true">→</span>
        </Button>
      );
    if (step === 9)
      return (
        <Button
          disabled={
            !impactAccepted ||
            (hasOpeningQuantity && !stockLocationId) ||
            preview?.status !== 'READY'
          }
          isLoading={busy}
          onClick={() => {
            void confirmImport();
          }}
        >
          <Icon name="check" size={18} /> Confirmar importação
        </Button>
      );
    if (step === 10)
      return (
        <div className="result-actions">
          <Button onClick={downloadReport}>
            <Icon name="download" size={18} /> Baixar relatório CSV
          </Button>
          <Button onClick={resetWizard} variant="secondary">
            Nova importação
          </Button>
        </div>
      );
    return null;
  };

  return (
    <div className="page-stack import-page">
      <header className="page-heading">
        <div>
          <span className="page-heading__eyebrow">Importação administrativa</span>
          <h1>Migração de dados</h1>
          <p>
            Um fluxo seguro para identificar, mapear, validar e confirmar dados externos sem
            gravação direta.
          </p>
        </div>
        <span className="module-badge">
          <Icon name="upload" size={18} /> Somente ADMIN
        </span>
      </header>
      <div className="import-workspace">
        <ImportStepper currentStep={step} />
        <section className="import-panel page-surface">
          <div className="import-panel__content">
            {error ? (
              <div className="import-error" role="alert">
                <Icon name="warning" size={19} />
                <span>{error}</span>
                <button
                  aria-label="Fechar erro"
                  onClick={() => {
                    setError(null);
                  }}
                  type="button"
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
            ) : null}
            {renderStep()}
          </div>
          <footer className="import-panel__footer">
            {step > 1 && step < 10 ? (
              <Button disabled={busy} onClick={back} variant="secondary">
                <span aria-hidden="true">←</span> Voltar
              </Button>
            ) : (
              <span />
            )}
            <div className="import-panel__footer-context">
              <span>{stepMeta?.label}</span>
              {primaryAction()}
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
