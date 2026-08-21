import type {
  CurrentStockReportQuery,
  ReportProductType,
  StockSituation,
} from '../../../modules/reports';

export interface StockScreenFilters {
  search: string;
  productType: ReportProductType | '';
  categoryId: string;
  situation: StockSituation | '';
  page: number;
  pageSize: number;
}

export function buildCurrentStockQuery(filters: StockScreenFilters): CurrentStockReportQuery {
  return {
    page: filters.page,
    pageSize: filters.pageSize,
    isActive: true,
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.productType ? { productType: filters.productType } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.situation ? { situation: filters.situation } : {}),
  };
}
