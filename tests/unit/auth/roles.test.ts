import { describe, expect, it } from 'vitest';

import { hasPermission, parseAssignedRoles, permissionsForRoles } from '../../../src/modules/auth';

describe('roles e permissões da aplicação', () => {
  it('restringe importações exclusivamente ao ADMIN', () => {
    expect(hasPermission(['ADMIN'], 'MANAGE_IMPORTS')).toBe(true);
    expect(hasPermission(['STOCK_OPERATOR'], 'MANAGE_IMPORTS')).toBe(false);
    expect(hasPermission(['VIEWER'], 'MANAGE_IMPORTS')).toBe(false);
  });

  it('permite operação de estoque ao operador sem conceder gerenciamento administrativo', () => {
    expect(hasPermission(['STOCK_OPERATOR'], 'OPERATE_STOCK')).toBe(true);
    expect(hasPermission(['STOCK_OPERATOR'], 'MANAGE_SYSTEM')).toBe(false);
    expect(permissionsForRoles(['VIEWER'])).toEqual(['VIEW_INVENTORY', 'VIEW_REPORTS']);
  });

  it('aceita somente roles conhecidas vindas do banco', () => {
    expect(
      parseAssignedRoles([
        { role: { code: 'ADMIN' } },
        { role: [{ code: 'VIEWER' }] },
        { role: { code: 'UNKNOWN' } },
        { role: null },
      ]),
    ).toEqual(['ADMIN', 'VIEWER']);
  });
});
