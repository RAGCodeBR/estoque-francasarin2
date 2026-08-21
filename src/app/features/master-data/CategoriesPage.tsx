import { useCallback, useMemo } from 'react';

import {
  CategoryService,
  SupabaseCategoryRepository,
  type Category,
} from '../../../modules/categories';
import { CrudDirectoryPage } from '../../components/operational/CrudDirectoryPage';
import type { TableColumn } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';
import { TextAreaField } from '../../components/ui/TextAreaField';

interface CategoryForm {
  name: string;
  description: string;
}
const columns: readonly TableColumn<Category>[] = [
  { key: 'name', label: 'Categoria', render: (item) => <strong>{item.name}</strong> },
  { key: 'description', label: 'Descrição', render: (item) => item.description ?? '—' },
];

export function CategoriesPage() {
  const service = useMemo(() => new CategoryService(new SupabaseCategoryRepository()), []);
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
      create={(value) =>
        service.create({ name: value.name, description: value.description || null })
      }
      description="Organize o catálogo em categorias preservando os vínculos históricos."
      emptyForm={{ name: '', description: '' }}
      eyebrow="Organização"
      icon="category"
      itemLabel="Categoria"
      load={load}
      renderForm={(value: CategoryForm, onChange) => (
        <div className="form-grid">
          <FormField
            label="Nome"
            onChange={(event) => {
              onChange({ ...value, name: event.target.value });
            }}
            required
            value={value.name}
          />
          <TextAreaField
            label="Descrição"
            onChange={(event) => {
              onChange({ ...value, description: event.target.value });
            }}
            value={value.description}
          />
        </div>
      )}
      setActive={(id, active) => (active ? service.reactivate(id) : service.deactivate(id))}
      title="Categorias"
      toForm={(item) => ({ name: item.name, description: item.description ?? '' })}
      update={(id, value) =>
        service.update(id, { name: value.name, description: value.description || null })
      }
    />
  );
}
