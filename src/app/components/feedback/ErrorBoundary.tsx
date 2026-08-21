import { Component, type ErrorInfo, type ReactNode } from 'react';

import { ErrorState } from './ErrorState';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erro não tratado na interface.', error, info.componentStack);
  }

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="fatal-error-page">
          <ErrorState
            description="A interface encontrou um erro inesperado. Recarregue a página para continuar."
            onRetry={() => {
              window.location.reload();
            }}
          />
        </main>
      );
    }

    return this.props.children;
  }
}
