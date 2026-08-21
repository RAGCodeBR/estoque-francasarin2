import { describe, expect, it } from 'vitest';

import {
  availableExportFormats,
  buildExportFilters,
  EMPTY_EXPORT_FILTERS,
} from '../../../src/app/features/exports/export-page-state';

describe('estado da tela de exportação', () => {
  it('oferece PDF somente para relatórios visuais', () => {
    expect(availableExportFormats('PRODUCTS')).toEqual(['XLSX', 'CSV']);
    expect(availableExportFormats('STOCK_CURRENT')).toEqual(['XLSX', 'CSV', 'PDF']);
    expect(availableExportFormats('PRODUCTS_WITH_CURRENT_STOCK')).toContain('PDF');
  });

  it('envia ao backend somente filtros permitidos para o conjunto escolhido', () => {
    const form = {
      ...EMPTY_EXPORT_FILTERS,
      search: '  arroz  ',
      categoryId: 'd1000000-0000-4000-8000-000000000002',
      productType: 'RAW' as const,
      activeStatus: 'ACTIVE' as const,
      locationId: 'd1000000-0000-4000-8000-000000000003',
      createdFrom: '2026-08-01',
      createdTo: '2026-08-20',
    };

    expect(buildExportFilters('PRODUCTS_WITH_CURRENT_STOCK', form)).toEqual({
      search: 'arroz',
      categoryId: 'd1000000-0000-4000-8000-000000000002',
      productType: 'RAW',
      isActive: true,
    });
    expect(buildExportFilters('LOSSES', form)).toEqual({
      search: 'arroz',
      categoryId: 'd1000000-0000-4000-8000-000000000002',
      locationId: 'd1000000-0000-4000-8000-000000000003',
      createdFrom: '2026-08-01T03:00:00.000Z',
      createdTo: '2026-08-21T02:59:59.999Z',
    });
  });
});
