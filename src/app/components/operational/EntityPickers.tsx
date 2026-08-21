import { useEffect, useMemo, useRef, useState } from 'react';

import type { Location } from '../../../modules/locations';
import { ProductService, SupabaseProductRepository, type Product } from '../../../modules/products';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { FormField } from '../ui/FormField';
import { SelectField } from '../ui/SelectField';

export function ProductSearchField({
  label = 'Produto',
  onSelect,
  selected,
}: {
  label?: string;
  onSelect: (product: Product | null) => void;
  selected: Product | null;
}) {
  const service = useMemo(() => new ProductService(new SupabaseProductRepository()), []);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);
  const [results, setResults] = useState<readonly Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!debounced.trim()) {
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const search = async () => {
      await Promise.resolve();
      if (requestId !== requestRef.current) return;
      setLoading(true);
      setError(null);
      try {
        const page = await service.search({
          search: debounced,
          isActive: true,
          page: 1,
          pageSize: 10,
        });
        if (requestId === requestRef.current) setResults(page.items);
      } catch (caught) {
        if (requestId === requestRef.current) {
          setError(caught instanceof Error ? caught.message : 'Não foi possível buscar produtos.');
          setResults([]);
        }
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    };
    void search();
    return () => {
      if (requestRef.current === requestId) requestRef.current += 1;
    };
  }, [debounced, service]);

  return (
    <div className="product-picker">
      <FormField
        hint={
          selected
            ? `Selecionado: ${selected.name} · ${selected.sku}`
            : 'Digite ao menos parte do nome ou SKU.'
        }
        label={label}
        onChange={(event) => {
          setSearch(event.target.value);
          onSelect(null);
        }}
        placeholder="Buscar por nome ou SKU"
        value={search}
      />
      {debounced && !selected ? (
        <div className="product-picker__results" role="listbox" aria-label="Produtos encontrados">
          {loading ? <span>Buscando...</span> : null}
          {error ? <span role="alert">{error}</span> : null}
          {!loading && !error && results.length === 0 ? (
            <span>Nenhum produto encontrado.</span>
          ) : null}
          {results.map((product) => (
            <button
              key={product.id}
              onClick={() => {
                onSelect(product);
                setSearch(`${product.name} · ${product.sku}`);
              }}
              role="option"
              type="button"
            >
              <strong>{product.name}</strong>
              <small>
                {product.sku} · {product.unit}
              </small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LocationSelect({
  label,
  locations,
  onChange,
  value,
}: {
  label: string;
  locations: readonly Location[];
  onChange: (id: string) => void;
  value: string;
}) {
  return (
    <SelectField
      label={label}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      required
      value={value}
    >
      <option value="">Selecione</option>
      {locations.map((location) => (
        <option key={location.id} value={location.id}>
          {location.name}
        </option>
      ))}
    </SelectField>
  );
}
