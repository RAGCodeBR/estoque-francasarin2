import { AppRouter } from './app/router/AppRouter';
import { AuthProvider } from './app/auth/AuthProvider';
import { ErrorBoundary } from './app/components/feedback/ErrorBoundary';
import { ToastProvider } from './app/components/feedback/ToastProvider';

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
