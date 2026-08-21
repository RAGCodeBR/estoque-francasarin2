import { Navigate, Route, Routes } from 'react-router';

import { AnonymousOnly, RequirePermission, RequireSession } from '../auth/RouteGuards';
import { AppShell } from '../layout/AppShell';
import { APP_ROUTES } from '../navigation/route-config';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { ModulePlaceholderPage } from '../pages/ModulePlaceholderPage';
import { NotFoundPage } from '../pages/NotFoundPage';

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
                {route.path === '/dashboard' ? (
                  <DashboardPage />
                ) : (
                  <ModulePlaceholderPage route={route} />
                )}
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
