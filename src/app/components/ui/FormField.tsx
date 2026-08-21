import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
  leading?: ReactNode;
}

export function FormField({
  error,
  hint,
  id,
  label,
  leading,
  className = '',
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helpId = `${inputId}-help`;

  return (
    <div className={`form-field ${error ? 'form-field--error' : ''} ${className}`.trim()}>
      <label htmlFor={inputId}>{label}</label>
      <div className="form-field__control">
        {leading ? <span className="form-field__leading">{leading}</span> : null}
        <input
          aria-describedby={error || hint ? helpId : undefined}
          aria-invalid={error ? true : undefined}
          id={inputId}
          {...props}
        />
      </div>
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
