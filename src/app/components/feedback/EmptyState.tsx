import type { ReactNode } from 'react';

import { Icon } from '../ui/Icon';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ action, compact = false, description, title }: EmptyStateProps) {
  return (
    <div className={`empty-state ${compact ? 'empty-state--compact' : ''}`}>
      <span className="empty-state__icon">
        <Icon name="file" size={22} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
