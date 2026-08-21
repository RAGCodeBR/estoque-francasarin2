import type { OperationalImportType } from '../domain/operational-types';

export interface OperationalTemplateDefinition {
  sheetName: string;
  headers: readonly string[];
  instructions: readonly string[];
  validations: readonly { column: number; values: readonly string[] }[];
}

export const OPERATIONAL_TEMPLATE_DEFINITIONS: Readonly<
  Record<OperationalImportType, OperationalTemplateDefinition>
> = {
  PRODUCTS: {
    sheetName: 'Produtos',
    headers: ['SKU', 'EAN', 'PRODUTO', 'CATEGORIA', 'TIPO', 'UNIDADE', 'QUANTIDADE_MINIMA'],
    instructions: [
      'Use uma linha por produto e não altere os cabeçalhos.',
      'TIPO aceita RAW ou FRACTIONATED; UNIDADE aceita UN ou KG.',
      'QUANTIDADE_MINIMA aceita até três casas decimais e nunca representa o saldo atual.',
      'Para conciliar saldo, use exclusivamente o modelo STOCK_RECONCILIATION.',
    ],
    validations: [
      { column: 5, values: ['RAW', 'FRACTIONATED'] },
      { column: 6, values: ['UN', 'KG'] },
    ],
  },
  CATEGORIES: {
    sheetName: 'Categorias',
    headers: ['CATEGORIA', 'DESCRICAO'],
    instructions: [
      'Use uma linha por categoria.',
      'Categorias existentes serão revisadas antes da atualização.',
    ],
    validations: [],
  },
  LOCATIONS: {
    sheetName: 'Locais',
    headers: ['LOCAL', 'DESCRICAO', 'TIPO_LOCAL'],
    instructions: [
      'TIPO_LOCAL aceita STOCK ou CONSUMPTION.',
      'Nenhum local com histórico será excluído.',
    ],
    validations: [{ column: 3, values: ['STOCK', 'CONSUMPTION'] }],
  },
  SUPPLIERS: {
    sheetName: 'Fornecedores',
    headers: ['CNPJ', 'RAZAO_SOCIAL', 'NOME_FANTASIA'],
    instructions: [
      'Use CNPJ válido quando disponível.',
      'A confirmação administrativa é obrigatória.',
    ],
    validations: [],
  },
  STOCK_RECONCILIATION: {
    sheetName: 'Reconciliacao',
    headers: ['SKU', 'EAN', 'QUANTIDADE_ATUAL'],
    instructions: [
      'Informe SKU ou EAN inequívoco e a quantidade contada no arquivo.',
      'O sistema exibirá saldo, quantidade do arquivo e diferença antes da confirmação.',
      'A confirmação gera ADJUSTMENT_POSITIVE ou ADJUSTMENT_NEGATIVE; nunca sobrescreve saldo.',
      'Motivo obrigatório: Reconciliação via importação.',
    ],
    validations: [],
  },
};
