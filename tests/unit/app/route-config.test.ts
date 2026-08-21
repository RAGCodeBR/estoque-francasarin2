import { describe, expect, it } from 'vitest';

import {
  APP_ROUTES,
  canAccessRoute,
  findRoute,
  routesForRoles,
} from '../../../src/app/navigation/route-config';

const expectedPaths = [
  '/dashboard',
  '/estoque',
  '/produtos',
  '/entradas',
  '/saidas',
  '/perdas',
  '/inventario',
  '/locais',
  '/categorias',
  '/fornecedores',
  '/relatorios',
  '/logs',
  '/importacoes',
  '/exportacoes',
  '/configuracoes',
];

describe('configuração de rotas da interface', () => {
  it('declara todas as rotas exigidas sem duplicidade', () => {
    const paths = APP_ROUTES.map((route) => route.path);
    expect(paths).toEqual(expectedPaths);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('concede ao ADMIN todos os módulos', () => {
    expect(routesForRoles(['ADMIN']).map((route) => route.path)).toEqual(expectedPaths);
  });

  it('restringe módulos administrativos do operador', () => {
    const operatorPaths = routesForRoles(['STOCK_OPERATOR']).map((route) => route.path);
    expect(operatorPaths).toContain('/entradas');
    expect(operatorPaths).toContain('/inventario');
    expect(operatorPaths).not.toContain('/importacoes');
    expect(operatorPaths).not.toContain('/logs');
    expect(operatorPaths).not.toContain('/configuracoes');
  });

  it('mantém VIEWER somente em consultas e relatórios', () => {
    expect(routesForRoles(['VIEWER']).map((route) => route.path)).toEqual([
      '/dashboard',
      '/estoque',
      '/produtos',
      '/locais',
      '/categorias',
      '/fornecedores',
      '/relatorios',
    ]);
  });

  it('não concede acesso sem role e encontra metadados por caminho', () => {
    expect(routesForRoles([])).toEqual([]);
    const imports = findRoute('/importacoes');
    expect(imports?.permission).toBe('MANAGE_IMPORTS');
    expect(imports ? canAccessRoute(['VIEWER'], imports) : true).toBe(false);
    expect(findRoute('/inexistente')).toBeUndefined();
  });
});
