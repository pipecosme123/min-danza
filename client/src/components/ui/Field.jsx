import { useId } from 'react';
import './Field.css';

/**
 * Campo de formulario accesible: <label> + control asociados por `id`,
 * texto de ayuda y mensaje de error. Cubre input/select/textarea con el
 * mismo look & feel para no duplicar estilos de formulario en cada página.
 *
 * @param {{
 *   label: string,
 *   as?: 'input'|'select'|'textarea',
 *   hint?: string,
 *   error?: string,
 *   required?: boolean,
 * }} props
 */
export function Field({ label, as = 'input', hint, error, required = false, id, children, className = '', ...rest }) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const Control = as;

  return (
    <div className={`field ${className}`}>
      <label htmlFor={fieldId} className="field__label">
        {label}
        {required ? (
          <span aria-hidden="true" className="field__required">
            {' '}
            *
          </span>
        ) : null}
      </label>

      <Control
        id={fieldId}
        className={`field__control ${error ? 'field__control--invalid' : ''}`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        {...rest}
      >
        {children}
      </Control>

      {hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
