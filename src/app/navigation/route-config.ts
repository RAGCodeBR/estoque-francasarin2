import { hasPermission, type AppPermission, type AppRole } from '../../modules/auth';

export type AppIconName =
  | 'adjustments'
  | 'archive'
  | 'arrow-down'
  | 'arrow-up'
  | 'building'
  | 'category'
  | 'chart'
  | 'dashboard'
  | 'download'
  | 'file'
  | 'history'
  | 'inventory'
  | 'map-pin'
  | 'package'
  | 'settings'
  | 'suppliers'
  | 'upload'
  | 'warning';

export interface AppRouteDefinition {
  path: string;
  label: string;
  eyebrow: string;
  description: string;
  icon: AppIconName;
  permission: AppPermission;
  section: 'VISÃO GERAL' | 'OPERAÇÃO' | 'CADASTROS' | 'GESTÃO';
}

export const APP_ROUTES = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    eyebrow: 'Visão geral',
    description: 'Acompanhe o acesso aos principais módulos da operação.',
    icon: 'dashboard',
    permission: 'VIEW_INVENTORY',
    section: 'VISÃO GERAL',
  },
  {
    path: '/estoque',
    label: 'Estoque',
    eyebrow: 'Estoque atual',
    description: 'Consulte saldos e situações de estoque sem alterar quantidades diretamente.',
    icon: 'inventory',
    permission: 'VIEW_INVENTORY',
    section: 'OPERAÇÃO',
  },
  {
    path: '/produtos',
    label: 'Produtos',
    eyebrow: 'Catálogo',
    description: 'Consulte e organize os dados mestres dos produtos.',
    icon: 'package',
    permission: 'VIEW_INVENTORY',
    section: 'CADASTROS',
  },
  {
    path: '/entradas',
    label: 'Entradas',
    eyebrow: 'Recebimento',
    description: 'Acesse os fluxos autorizados de recebimento e notas fiscais.',
    icon: 'arrow-down',
    permission: 'OPERATE_STOCK',
    section: 'OPERAÇÃO',
  },
  {
    path: '/saidas',
    label: 'Saídas',
    eyebrow: 'Consumo',
    description: 'Registre saídas para locais de consumo por meio do motor transacional.',
    icon: 'arrow-up',
    permission: 'OPERATE_STOCK',
    section: 'OPERAÇÃO',
  },
  {
    path: '/perdas',
    label: 'Perdas',
    eyebrow: 'Controle de perdas',
    description: 'Registre e acompanhe perdas com motivo e rastreabilidade.',
    icon: 'warning',
    permission: 'OPERATE_STOCK',
    section: 'OPERAÇÃO',
  },
  {
    path: '/inventario',
    label: 'Inventário',
    eyebrow: 'Contagem física',
    description: 'Organize contagens e revisões antes de qualquer ajuste de estoque.',
    icon: 'archive',
    permission: 'OPERATE_STOCK',
    section: 'OPERAÇÃO',
  },
  {
    path: '/locais',
    label: 'Locais',
    eyebrow: 'Estrutura física',
    description: 'Consulte locais de estoque e consumo cadastrados.',
    icon: 'map-pin',
    permission: 'VIEW_INVENTORY',
    section: 'CADASTROS',
  },
  {
    path: '/categorias',
    label: 'Categorias',
    eyebrow: 'Organização',
    description: 'Consulte a classificação utilizada pelo catálogo de produtos.',
    icon: 'category',
    permission: 'VIEW_INVENTORY',
    section: 'CADASTROS',
  },
  {
    path: '/fornecedores',
    label: 'Fornecedores',
    eyebrow: 'Parceiros',
    description: 'Consulte fornecedores e vínculos com produtos.',
    icon: 'suppliers',
    permission: 'VIEW_INVENTORY',
    section: 'CADASTROS',
  },
  {
    path: '/relatorios',
    label: 'Relatórios',
    eyebrow: 'Análises',
    description: 'Acesse relatórios paginados e filtrados no banco.',
    icon: 'chart',
    permission: 'VIEW_REPORTS',
    section: 'GESTÃO',
  },
  {
    path: '/logs',
    label: 'Logs',
    eyebrow: 'Auditoria',
    description: 'Consulte eventos administrativos e rastreabilidade do sistema.',
    icon: 'history',
    permission: 'MANAGE_SYSTEM',
    section: 'GESTÃO',
  },
  {
    path: '/importacoes',
    label: 'Importações',
    eyebrow: 'Entrada de dados',
    description: 'Gerencie staging, validações e confirmações administrativas.',
    icon: 'upload',
    permission: 'MANAGE_IMPORTS',
    section: 'GESTÃO',
  },
  {
    path: '/exportacoes',
    label: 'Exportações',
    eyebrow: 'Portabilidade',
    description: 'Prepare exportações operacionais seguras e auditáveis.',
    icon: 'download',
    permission: 'MANAGE_SYSTEM',
    section: 'GESTÃO',
  },
  {
    path: '/configuracoes',
    label: 'Configurações',
    eyebrow: 'Administração',
    description: 'Gerencie configurações reservadas aos administradores.',
    icon: 'settings',
    permission: 'MANAGE_SYSTEM',
    section: 'GESTÃO',
  },
] as const satisfies readonly AppRouteDefinition[];

export const ROUTE_SECTIONS = ['VISÃO GERAL', 'OPERAÇÃO', 'CADASTROS', 'GESTÃO'] as const;

export function canAccessRoute(
  roles: readonly AppRole[],
  route: Pick<AppRouteDefinition, 'permission'>,
): boolean {
  return hasPermission(roles, route.permission);
}

export function routesForRoles(roles: readonly AppRole[]): readonly AppRouteDefinition[] {
  return APP_ROUTES.filter((route) => canAccessRoute(roles, route));
}

export function findRoute(pathname: string): AppRouteDefinition | undefined {
  return APP_ROUTES.find((route) => route.path === pathname);
}
