import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CategoryService,
  SupabaseCategoryRepository,
  type Category,
} from '../../../modules/categories';
import {
  ProductService,
  SupabaseProductRepository,
  type Product,
  type ProductType,
  type UnitType,
} from '../../../modules/products';
import { CrudDirectoryPage } from '../../components/operational/CrudDirectoryPage';
import { formatDecimal } from '../../components/operational/operational-format';
import type { TableColumn } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';

interface ProductForm {
  name: string;
  sku: string;
  ean: string;
  categoryId: string;
  productType: ProductType;
  unit: UnitType;
  minimumQuantity: string;
}

const emptyForm: ProductForm = {
  name: '',
  sku: '',
  ean: '',
  categoryId: '',
  productType: 'RAW',
  unit: 'UN',
  minimumQuantity: '0',
};

const columns: readonly TableColumn<Product>[] = [
  {
    key: 'name',
    label: 'Produto',
    render: (item) => (
      <div className="table-primary-cell">
        <strong>{item.name}</strong>
        {item.ean ? <small>EAN {item.ean}</small> : null}
      </div>
    ),
  },
  { key: 'sku', label: 'SKU', render: (item) => <code>{item.sku}</code> },
  { key: 'category', label: 'Categoria', render: (item) => item.category.name },
  {
    key: 'type',
    label: 'Tipo',
    render: (item) => (item.productType === 'RAW' ? 'Bruto' : 'Fracionado'),
  },
  { key: 'unit', label: 'Unidade', render: (item) => item.unit, align: 'center' },
  {
    key: 'minimum',
    label: 'Mínimo',
    render: (item) => formatDecimal(item.minimumQuantity),
    align: 'right',
  },
];

export function ProductsPage() {
  const service = useMemo(() => new ProductService(new SupabaseProductRepository()), []);
  const categoryService = useMemo(() => new CategoryService(new SupabaseCategoryRepository()), []);
  const [categories, setCategories] = useState<readonly Category[]>([]);
  useEffect(() => {
    void categoryService
      .search({ isActive: true, page: 1, pageSize: 100 })
      .then((page) => {
        setCategories(page.items);
      })
      .catch(() => {
        setCategories([]);
      });
  }, [categoryService]);
  const load = useCallback(
    ({
      search,
      isActive,
      page,
      pageSize,
    }: {
      search: string;
      isActive: boolean | undefined;
      page: number;
      pageSize: number;
    }) =>
      service.search({
        page,
        pageSize,
        ...(search ? { search } : {}),
        ...(isActive === undefined ? {} : { isActive }),
      }),
    [service],
  );
  return (
    <CrudDirectoryPage
      columns={columns}
      create={(value) => service.create({ ...value, ean: value.ean || null })}
      description="Cadastre e organize produtos sem misturar dados mestres com saldo de estoque."
      emptyForm={emptyForm}
      eyebrow="Catálogo"
      icon="package"
      itemLabel="Produto"
      load={load}
      renderForm={(value, onChange) => (
        <div className="form-grid">
          <FormField
            label="Nome"
            onChange={(event) => {
              onChange({ ...value, name: event.target.value });
            }}
            required
            value={value.name}
          />
          <FormField
            label="SKU"
            onChange={(event) => {
              onChange({ ...value, sku: event.target.value });
            }}
            required
            value={value.sku}
          />
          <FormField
            label="EAN"
            onChange={(event) => {
              onChange({ ...value, ean: event.target.value });
            }}
            value={value.ean}
          />
          <SelectField
            label="Categoria"
            onChange={(event) => {
              onChange({ ...value, categoryId: event.target.value });
            }}
            required
            value={value.categoryId}
          >
            <option value="">Selecione</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Tipo"
            onChange={(event) => {
              onChange({ ...value, productType: event.target.value as ProductType });
            }}
            value={value.productType}
          >
            <option value="RAW">Bruto</option>
            <option value="FRACTIONATED">Fracionado</option>
          </SelectField>
          <SelectField
            label="Unidade"
            onChange={(event) => {
              onChange({ ...value, unit: event.target.value as UnitType });
            }}
            value={value.unit}
          >
            <option value="UN">UN</option>
            <option value="KG">KG</option>
          </SelectField>
          <FormField
            label="Quantidade mínima"
            onChange={(event) => {
              onChange({ ...value, minimumQuantity: event.target.value });
            }}
            required
            value={value.minimumQuantity}
          />
          <p className="form-safety-note">Saldo não é editável nesta tela.</p>
        </div>
      )}
      setActive={(id, active) => (active ? service.reactivate(id) : service.deactivate(id))}
      title="Produtos"
      toForm={(item) => ({
        name: item.name,
        sku: item.sku,
        ean: item.ean ?? '',
        categoryId: item.category.id,
        productType: item.productType,
        unit: item.unit,
        minimumQuantity: item.minimumQuantity,
      })}
      update={(id, value) => service.update(id, { ...value, ean: value.ean || null })}
    />
  );
}
