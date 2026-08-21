import { useMemo, useState, type SyntheticEvent } from 'react';

import {
  InventoryCountService,
  SupabaseInventoryCountRepository,
  type InventoryCountReport,
} from '../../../modules/inventory';
import type { Product } from '../../../modules/products';
import { EmptyState } from '../../components/feedback/EmptyState';
import { LocationSelect, ProductSearchField } from '../../components/operational/EntityPickers';
import {
  InlineError,
  OperationalPageHeader,
  StatusBadge,
} from '../../components/operational/OperationalPage';
import {
  createIdempotencyKey,
  formatDecimal,
} from '../../components/operational/operational-format';
import { useActiveLocations } from '../../hooks/use-active-locations';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Icon } from '../../components/ui/Icon';
import { TextAreaField } from '../../components/ui/TextAreaField';

interface CountedItem {
  product: Product;
  quantity: string;
}

const statusLabel = {
  DRAFT: 'Rascunho',
  COUNTING: 'Em contagem',
  REVIEW: 'Em revisão',
  CONFIRMED: 'Confirmado',
} as const;

export function InventoryPage() {
  const service = useMemo(
    () => new InventoryCountService(new SupabaseInventoryCountRepository()),
    [],
  );
  const stocks = useActiveLocations('STOCK');
  const [locationId, setLocationId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [report, setReport] = useState<InventoryCountReport | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState('');
  const [items, setItems] = useState<readonly CountedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const execute = async (action: () => Promise<InventoryCountReport>) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível avançar o inventário.');
    } finally {
      setBusy(false);
    }
  };

  const create = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void execute(() =>
      service.create({
        locationId,
        ...(reference.trim() ? { reference } : {}),
        ...(notes.trim() ? { notes } : {}),
      }),
    );
  };
  const addItem = () => {
    if (!product || !quantity.trim()) {
      setError('Selecione um produto e informe a contagem física.');
      return;
    }
    if (items.some((item) => item.product.id === product.id)) {
      setError('O produto já está na contagem.');
      return;
    }
    setItems((current) => [...current, { product, quantity }]);
    setProduct(null);
    setQuantity('');
  };

  const reset = () => {
    setReport(null);
    setItems([]);
    setLocationId('');
    setReference('');
    setNotes('');
    setError(null);
  };

  return (
    <div className="page-stack">
      <OperationalPageHeader
        description="Contagens seguem DRAFT → COUNTING → REVIEW → CONFIRMED. Diferenças só movimentam estoque na confirmação."
        eyebrow="Contagem física"
        icon="archive"
        title="Inventário"
      />
      {!report ? (
        <form className="page-surface operational-surface operational-form" onSubmit={create}>
          <div className="form-section-heading">
            <span>
              <Icon name="archive" />
            </span>
            <div>
              <h2>Novo inventário</h2>
              <p>Defina o local e a referência da contagem.</p>
            </div>
          </div>
          <div className="form-grid form-grid--two">
            <LocationSelect
              label="Local de estoque"
              locations={stocks.locations}
              onChange={setLocationId}
              value={locationId}
            />
            <FormField
              label="Referência"
              onChange={(event) => {
                setReference(event.target.value);
              }}
              placeholder="Ex.: Inventário agosto/2026"
              value={reference}
            />
          </div>
          <TextAreaField
            label="Observações"
            onChange={(event) => {
              setNotes(event.target.value);
            }}
            value={notes}
          />
          <InlineError message={error ?? stocks.error} />
          <div className="operation-submit">
            <span>Nenhum saldo será alterado ao criar.</span>
            <Button disabled={!locationId} isLoading={busy} type="submit">
              Criar inventário
            </Button>
          </div>
        </form>
      ) : (
        <div className="inventory-workspace">
          <section className="page-surface operational-surface">
            <div className="inventory-status-row">
              <div>
                <span className="page-heading__eyebrow">Inventário ativo</span>
                <h2>{report.reference ?? 'Sem referência'}</h2>
                <code>{report.inventoryCountId}</code>
              </div>
              <StatusBadge tone={report.status === 'CONFIRMED' ? 'success' : 'warning'}>
                {statusLabel[report.status]}
              </StatusBadge>
            </div>
            {report.status === 'DRAFT' ? (
              <div className="inventory-stage-callout">
                <p>Abra a contagem para começar a registrar quantidades físicas.</p>
                <Button
                  isLoading={busy}
                  onClick={() => {
                    void execute(() => service.open(report.inventoryCountId));
                  }}
                >
                  Iniciar contagem
                </Button>
              </div>
            ) : null}
            {report.status === 'COUNTING' ? (
              <>
                <div className="operation-item-builder">
                  <ProductSearchField
                    label="Produto contado"
                    onSelect={setProduct}
                    selected={product}
                  />
                  <FormField
                    label="Quantidade física"
                    onChange={(event) => {
                      setQuantity(event.target.value);
                    }}
                    placeholder="0.000"
                    value={quantity}
                  />
                  <Button onClick={addItem} variant="secondary">
                    Adicionar
                  </Button>
                </div>
                {items.length ? (
                  <div className="pending-items">
                    {items.map((item) => (
                      <div key={item.product.id}>
                        <span>
                          <strong>{item.product.name}</strong>
                          <small>
                            {item.product.sku} · {item.product.unit}
                          </small>
                        </span>
                        <b>{item.quantity}</b>
                        <button
                          onClick={() => {
                            setItems((current) =>
                              current.filter(
                                ({ product: currentProduct }) =>
                                  currentProduct.id !== item.product.id,
                              ),
                            );
                          }}
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    description="Inclua os produtos e suas quantidades físicas."
                    title="Nenhum item contado"
                  />
                )}
                <div className="inventory-stage-actions">
                  <Button
                    disabled={!items.length}
                    isLoading={busy}
                    onClick={() => {
                      void execute(() =>
                        service.saveItems({
                          inventoryCountId: report.inventoryCountId,
                          replace: true,
                          items: items.map((item) => ({
                            productId: item.product.id,
                            countedQuantity: item.quantity,
                          })),
                        }),
                      );
                    }}
                    variant="secondary"
                  >
                    Salvar contagem
                  </Button>
                  <Button
                    disabled={report.itemCount === 0}
                    isLoading={busy}
                    onClick={() => {
                      void execute(() => service.review(report.inventoryCountId));
                    }}
                  >
                    Enviar para revisão
                  </Button>
                </div>
              </>
            ) : null}
            {report.status === 'REVIEW' ? (
              <>
                <div className="inventory-review-grid">
                  <div>
                    <span>Positivos</span>
                    <strong>{report.positiveAdjustments}</strong>
                  </div>
                  <div>
                    <span>Negativos</span>
                    <strong>{report.negativeAdjustments}</strong>
                  </div>
                  <div>
                    <span>Sem diferença</span>
                    <strong>{report.unchangedItems}</strong>
                  </div>
                </div>
                <p className="form-safety-note">
                  Nenhuma diferença foi aplicada. A confirmação criará apenas movimentos
                  compensatórios.
                </p>
                <Button
                  isLoading={busy}
                  onClick={() => {
                    void execute(() =>
                      service.confirm(report.inventoryCountId, createIdempotencyKey('inventory')),
                    );
                  }}
                >
                  <Icon name="check" size={18} /> Confirmar ajustes
                </Button>
              </>
            ) : null}
            {report.status === 'CONFIRMED' ? (
              <div className="backend-result">
                <StatusBadge tone="success">Concluído</StatusBadge>
                <h2>{report.movementsCreated} movimento(s) criado(s)</h2>
                <p>
                  {report.itemCount} itens contados. O relatório abaixo veio da confirmação do
                  backend.
                </p>
                <Button onClick={reset} variant="secondary">
                  Novo inventário
                </Button>
              </div>
            ) : null}
            <InlineError message={error} />
          </section>
          {report.items.length ? (
            <aside className="page-surface operation-summary">
              <span className="page-heading__eyebrow">Resumo por item</span>
              {report.items.slice(0, 8).map((item) => (
                <div className="inventory-item-summary" key={item.itemId}>
                  <code>{item.productId}</code>
                  <span>Físico {formatDecimal(item.countedQuantity, item.unit)}</span>
                  <strong>
                    {item.differenceQuantity === null
                      ? 'Aguardando revisão'
                      : `Diferença ${formatDecimal(item.differenceQuantity, item.unit)}`}
                  </strong>
                </div>
              ))}
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
