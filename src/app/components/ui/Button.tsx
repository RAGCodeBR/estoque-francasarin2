import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  isLoading?: boolean;
}

export function Button({
  children,
  className = '',
  disabled,
  isLoading = false,
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} ${className}`.trim()}
      disabled={isLoading ? true : disabled}
      type={type}
      {...props}
    >
      {isLoading ? <span aria-hidden="true" className="button__spinner" /> : null}
      {children}
    </button>
  );
}
