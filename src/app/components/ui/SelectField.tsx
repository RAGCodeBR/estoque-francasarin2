import { useId, type SelectHTMLAttributes } from 'react';

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function SelectField({
  className = '',
  error,
  hint,
  id,
  label,
  ...props
}: SelectFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helpId = `${inputId}-help`;
  return (
    <div className={`select-field ${error ? 'select-field--error' : ''} ${className}`.trim()}>
      <label htmlFor={inputId}>{label}</label>
      <select
        aria-describedby={error || hint ? helpId : undefined}
        aria-invalid={error ? true : undefined}
        id={inputId}
        {...props}
      />
      {error ? (
        <span className="form-field__error" id={helpId} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="form-field__hint" id={helpId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
