import { useId } from 'react';
import './Checkbox.css';

/**
 * Casilla de verificación accesible para un booleano opcional de un
 * formulario (ej. "Joven", "Habilitar equipo de jóvenes"). Distinta de
 * `Field` (que cubre input/select/textarea): la casilla y su etiqueta viven
 * dentro de un único `<label>` para que todo el renglón sea el objetivo de
 * click/tap, no solo el cuadrito de 24×24, y así se cumpla el tamaño mínimo
 * de 44×44px en la práctica.
 *
 * @param {{
 *   label: string,
 *   hint?: string,
 *   checked: boolean,
 *   onChange: (checked: boolean) => void,
 *   disabled?: boolean,
 *   id?: string,
 * }} props
 */
export function Checkbox({ label, hint, checked, onChange, disabled = false, id, ...rest }) {
  const generatedId = useId();
  const checkboxId = id || generatedId;
  const hintId = hint ? `${checkboxId}-hint` : undefined;

  return (
    <div className="checkbox-field">
      <label htmlFor={checkboxId} className="checkbox-field__row">
        <input
          type="checkbox"
          id={checkboxId}
          className="checkbox-field__input"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={hintId}
          {...rest}
        />
        <span className="checkbox-field__label">{label}</span>
      </label>

      {hint ? (
        <p id={hintId} className="checkbox-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
