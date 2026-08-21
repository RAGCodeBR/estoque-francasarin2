import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { AnonymousOnly, RequirePermission, RequireSession } from '../auth/RouteGuards';
import { LoadingState } from '../components/feedback/LoadingState';
import { AppShell } from '../layout/AppShell';
import { APP_ROUTES } from '../navigation/route-config';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { ModulePlaceholderPage } from '../pages/ModulePlaceholderPage';
import { NotFoundPage } from '../pages/NotFoundPage';

const ImportWizardPage = lazy(() =>
  import('../features/imports/ImportWizardPage').then((module) => ({
    default: module.ImportWizardPage,
  })),
);
const StockPage = lazy(() =>
  import('../features/stock/StockPage').then((module) => ({ default: module.StockPage })),
);
const ProductsPage = lazy(() =>
  import('../features/master-data/ProductsPage').then((module) => ({
    default: module.ProductsPage,
  })),
);
const CategoriesPage = lazy(() =>
  import('../features/master-data/CategoriesPage').then((module) => ({
    default: module.CategoriesPage,
  })),
);
const LocationsPage = lazy(() =>
  import('../features/master-data/LocationsPage').then((module) => ({
    default: module.LocationsPage,
  })),
);
const SuppliersPage = lazy(() =>
  import('../features/master-data/SuppliersPage').then((module) => ({
    default: module.SuppliersPage,
  })),
);
const EntriesPage = lazy(() =>
  import('../features/operations/EntriesPage').then((module) => ({ default: module.EntriesPage })),
);
const StockOutputsPage = lazy(() =>
  import('../features/operations/StockOutputsPage').then((module) => ({
    default: module.StockOutputsPage,
  })),
);
const LossesPage = lazy(() =>
  import('../features/operations/LossesPage').then((module) => ({ default: module.LossesPage })),
);
const InventoryPage = lazy(() =>
  import('../features/operations/InventoryPage').then((module) => ({
    default: module.InventoryPage,
  })),
);
const ReportsPage = lazy(() =>
  import('../features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })),
);
const AuditLogsPage = lazy(() =>
  import('../features/audit/AuditLogsPage').then((module) => ({ default: module.AuditLogsPage })),
);
const ExportsPage = lazy(() =>
  import('../features/exports/ExportsPage').then((module) => ({ default: module.ExportsPage })),
);

function RoutePage({ route }: { route: (typeof APP_ROUTES)[number] }) {
  switch (route.path) {
    case '/dashboard':
      return <DashboardPage />;
    case '/estoque':
      return <StockPage />;
    case '/produtos':
      return <ProductsPage />;
    case '/categorias':
      return <CategoriesPage />;
    case '/locais':
      return <LocationsPage />;
    case '/fornecedores':
      return <SuppliersPage />;
    case '/entradas':
      return <EntriesPage />;
    case '/saidas':
      return <StockOutputsPage />;
    case '/perdas':
      return <LossesPage />;
    case '/inventario':
      return <InventoryPage />;
    case '/relatorios':
      return <ReportsPage />;
    case '/logs':
      return <AuditLogsPage />;
    case '/importacoes':
      return <ImportWizardPage />;
    case '/exportacoes':
      return <ExportsPage />;
    default:
      return <ModulePlaceholderPage route={route} />;
  }
}

export function AppRouter() {
  return (
    <Routes>
      <Route
        element={
          <AnonymousOnly>
            <LoginPage />
          </AnonymousOnly>
        }
        path="/login"
      />

      <Route
        element={
          <RequireSession>
            <AppShell />
          </RequireSession>
        }
      >
        <Route element={<Navigate replace to="/dashboard" />} index />
        {APP_ROUTES.map((route) => (
          <Route
            element={
              <RequirePermission permission={route.permission}>
                <Suspense
                  fallback={
                    <LoadingState label={`Carregando ${route.label.toLocaleLowerCase('pt-BR')}`} />
                  }
                >
                  <RoutePage route={route} />
                </Suspense>
              </RequirePermission>
            }
            key={route.path}
            path={route.path}
          />
        ))}
        <Route element={<NotFoundPage />} path="*" />
      </Route>
    </Routes>
  );
}
