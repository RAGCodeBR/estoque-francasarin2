import { useId, type TextareaHTMLAttributes } from 'react';

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextAreaField({
  className = '',
  error,
  hint,
  id,
  label,
  ...props
}: TextAreaFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helpId = `${inputId}-help`;
  return (
    <div className={`textarea-field ${error ? 'textarea-field--error' : ''} ${className}`.trim()}>
      <label htmlFor={inputId}>{label}</label>
      <textarea
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
