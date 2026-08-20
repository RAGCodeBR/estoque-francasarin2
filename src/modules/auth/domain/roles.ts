export const APP_ROLES = ['ADMIN', 'STOCK_OPERATOR', 'VIEWER'] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const APP_PERMISSIONS = [
  'MANAGE_SYSTEM',
  'OPERATE_STOCK',
  'VIEW_INVENTORY',
  'VIEW_REPORTS',
  'MANAGE_IMPORTS',
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<AppRole, readonly AppPermission[]>> = Object.freeze({
  ADMIN: APP_PERMISSIONS,
  STOCK_OPERATOR: ['OPERATE_STOCK', 'VIEW_INVENTORY', 'VIEW_REPORTS'],
  VIEWER: ['VIEW_INVENTORY', 'VIEW_REPORTS'],
});

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLES.includes(value as AppRole);
}

export function permissionsForRoles(roles: readonly AppRole[]): readonly AppPermission[] {
  return [...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]))];
}

export function hasPermission(roles: readonly AppRole[], permission: AppPermission): boolean {
  return permissionsForRoles(roles).includes(permission);
}
