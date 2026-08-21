import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  description = 'Não foi possível concluir esta operação. Tente novamente.',
  onRetry,
  title = 'Algo não saiu como esperado',
}: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <span className="error-state__icon">
        <Icon name="warning" size={24} />
      </span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        {onRetry ? <Button onClick={onRetry}>Tentar novamente</Button> : null}
      </div>
    </div>
  );
}
