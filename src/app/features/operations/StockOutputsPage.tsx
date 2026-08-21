import { useMemo, useState, type SyntheticEvent } from 'react';

import {
  StockOutputService,
  SupabaseStockOutputRepository,
  type StockOutputItemResult,
  type StockOutputReport,
} from '../../../modules/inventory';
import type { Product } from '../../../modules/products';
import { EmptyState } from '../../components/feedback/EmptyState';
import { LocationSelect, ProductSearchField } from '../../components/operational/EntityPickers';
import { InlineError, OperationalPageHeader } from '../../components/operational/OperationalPage';
import {
  createIdempotencyKey,
  formatDateTime,
  formatDecimal,
} from '../../components/operational/operational-format';
import { useActiveLocations } from '../../hooks/use-active-locations';
import { Button } from '../../components/ui/Button';
import { DataTable, type TableColumn } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';
import { Icon } from '../../components/ui/Icon';
import { TextAreaField } from '../../components/ui/TextAreaField';

interface PendingOutput {
  product: Product;
  quantity: string;
}

const resultColumns: readonly TableColumn<StockOutputItemResult>[] = [
  { key: 'product', label: 'Produto', render: (item) => <code>{item.productId}</code> },
  {
    key: 'quantity',
    label: 'Quantidade',
    render: (item) => formatDecimal(item.quantity, item.unit),
    align: 'right',
  },
  {
    key: 'balance',
    label: 'Novo saldo',
    render: (item) => <strong>{formatDecimal(item.newBalance, item.unit)}</strong>,
    align: 'right',
  },
  {
    key: 'date',
    label: 'Confirmado em',
    render: (item) => formatDateTime(item.createdAt),
    align: 'right',
  },
];

export function StockOutputsPage() {
  const service = useMemo(() => new StockOutputService(new SupabaseStockOutputRepository()), []);
  const stocks = useActiveLocations('STOCK');
  const destinations = useActiveLocations('CONSUMPTION');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('Consumo operacional');
  const [items, setItems] = useState<readonly PendingOutput[]>([]);
  const [result, setResult] = useState<StockOutputReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addItem = () => {
    if (!selectedProduct || !quantity.trim()) {
      setError('Selecione um produto e informe a quantidade.');
      return;
    }
    if (items.some(({ product }) => product.id === selectedProduct.id)) {
      setError('O produto já está no lote. Remova-o antes de adicionar novamente.');
      return;
    }
    setItems((current) => [...current, { product: selectedProduct, quantity }]);
    setSelectedProduct(null);
    setQuantity('');
    setError(null);
  };

  const confirm = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const report = await service.confirmBatch({
        sourceLocationId,
        destinationLocationId,
        reason,
        idempotencyKey: createIdempotencyKey('stock-output'),
        items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
      });
      setResult(report);
      setItems([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível confirmar a saída.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <OperationalPageHeader
        description="Monte um lote all-or-nothing. Saldos exibidos após a operação vêm da resposta confirmada pelo motor."
        eyebrow="Consumo"
        icon="arrow-up"
        title="Saídas"
      />
      <div className="operation-layout">
        <form
          className="page-surface operational-surface operational-form"
          onSubmit={(event) => {
            void confirm(event);
          }}
        >
          <div className="form-section-heading">
            <span>
              <Icon name="map-pin" />
            </span>
            <div>
              <h2>Origem e destino</h2>
              <p>Somente locais ativos e compatíveis.</p>
            </div>
          </div>
          <div className="form-grid form-grid--two">
            <LocationSelect
              label="Estoque de origem"
              locations={stocks.locations}
              onChange={setSourceLocationId}
              value={sourceLocationId}
            />
            <LocationSelect
              label="Local de consumo"
              locations={destinations.locations}
              onChange={setDestinationLocationId}
              value={destinationLocationId}
            />
          </div>
          <div className="form-section-heading">
            <span>
              <Icon name="package" />
            </span>
            <div>
              <h2>Itens da saída</h2>
              <p>Até 100 itens na mesma transação.</p>
            </div>
          </div>
          <div className="operation-item-builder">
            <ProductSearchField onSelect={setSelectedProduct} selected={selectedProduct} />
            <FormField
              label="Quantidade"
              onChange={(event) => {
                setQuantity(event.target.value);
              }}
              placeholder="0.000"
              value={quantity}
            />
            <Button onClick={addItem} variant="secondary">
              <span aria-hidden="true">+</span> Adicionar
            </Button>
          </div>
          {items.length > 0 ? (
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
                    aria-label={`Remover ${item.product.name}`}
                    onClick={() => {
                      setItems((current) =>
                        current.filter(({ product }) => product.id !== item.product.id),
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
              description="Adicione um ou mais produtos antes de confirmar."
              title="Lote vazio"
            />
          )}
          <TextAreaField
            label="Motivo"
            onChange={(event) => {
              setReason(event.target.value);
            }}
            required
            value={reason}
          />
          <InlineError message={error ?? stocks.error ?? destinations.error} />
          <div className="operation-submit">
            <span>{items.length} item(ns) · confirmação atômica</span>
            <Button
              disabled={items.length === 0 || !sourceLocationId || !destinationLocationId}
              isLoading={busy}
              type="submit"
            >
              <Icon name="check" size={18} /> Confirmar saída
            </Button>
          </div>
        </form>
        <aside className="page-surface operation-summary">
          <span className="page-heading__eyebrow">Última confirmação</span>
          {result ? (
            <>
              <h2>{result.movementCount} movimentação(ões)</h2>
              <p>{result.applied ? 'Operação aplicada' : 'Requisição idempotente já processada'}</p>
              <code>{result.batchId}</code>
            </>
          ) : (
            <EmptyState
              compact
              description="O comprovante do backend aparecerá aqui."
              title="Nenhuma saída confirmada"
            />
          )}
        </aside>
      </div>
      {result ? (
        <section className="page-surface operational-surface">
          <h2>Saldos confirmados pelo backend</h2>
          <DataTable
            caption="Resultado da saída"
            columns={resultColumns}
            emptyContent={<span />}
            getRowKey={(item) => item.movementId}
            rows={result.items}
          />
        </section>
      ) : null}
    </div>
  );
}
