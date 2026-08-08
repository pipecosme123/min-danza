import { useId, useState } from 'react';
import './ColorPalettePicker.css';

/**
 * Paleta fija de colores de uniforme. Contrato cerrado:
 * `docs/architecture/phase4b-schedule-refinements-contract.md` §4. No es una
 * paleta cerrada de verdad: convive con la opción "Personalizado" de abajo.
 */
export const UNIFORM_COLOR_PALETTE = [
  { name: 'Azul', hex: '#1E40AF' },
  { name: 'Rojo', hex: '#DC2626' },
  { name: 'Verde', hex: '#16A34A' },
  { name: 'Amarillo', hex: '#EAB308' },
  { name: 'Naranja', hex: '#EA580C' },
  { name: 'Morado', hex: '#7C3AED' },
  { name: 'Rosado', hex: '#DB2777' },
  { name: 'Celeste', hex: '#0EA5E9' },
  { name: 'Gris', hex: '#6B7280' },
  { name: 'Negro', hex: '#111827' },
  { name: 'Blanco', hex: '#F9FAFB' },
  { name: 'Café', hex: '#92400E' },
];

function findPaletteColor(hex) {
  if (!hex) return null;
  return UNIFORM_COLOR_PALETTE.find((color) => color.hex.toLowerCase() === hex.toLowerCase()) ?? null;
}

/**
 * Fila de swatches clicables de la paleta fija + un swatch "Personalizado"
 * que revela un `<input type="color">` para cualquier otro valor. Si el
 * `value` con el que monta no coincide con ningún color de la paleta, abre
 * directamente en modo personalizado con ese valor precargado (no se pierde
 * el dato). El modo se decide una sola vez al montar a propósito: como
 * `Modal` desmonta su contenido al cerrarse, cada apertura del formulario
 * vuelve a montar este componente y recalcula el modo correcto para el
 * uniforme que se esté editando.
 *
 * @param {{ label: string, value: string, onChange: (hex: string) => void, hint?: string }} props
 */
export function ColorPalettePicker({ label, value, onChange, hint }) {
  const [customMode, setCustomMode] = useState(() => Boolean(value) && !findPaletteColor(value));
  const groupLabelId = useId();

  function selectPaletteColor(hex) {
    setCustomMode(false);
    onChange(hex);
  }

  function selectCustomMode() {
    setCustomMode(true);
    if (!value) onChange(UNIFORM_COLOR_PALETTE[0].hex);
  }

  const customValue = value || UNIFORM_COLOR_PALETTE[0].hex;

  return (
    <div className="color-palette-picker">
      <span className="field__label color-palette-picker__label" id={groupLabelId}>
        {label}
      </span>

      <div className="color-palette-picker__swatches" role="group" aria-labelledby={groupLabelId}>
        {UNIFORM_COLOR_PALETTE.map((color) => {
          const selected = !customMode && Boolean(value) && value.toLowerCase() === color.hex.toLowerCase();
          return (
            <button
              key={color.hex}
              type="button"
              className={`color-palette-picker__swatch${selected ? ' color-palette-picker__swatch--selected' : ''}`}
              style={{ backgroundColor: color.hex }}
              aria-pressed={selected}
              aria-label={color.name}
              title={color.name}
              onClick={() => selectPaletteColor(color.hex)}
            >
              {selected ? (
                <span aria-hidden="true" className="color-palette-picker__check">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}

        <button
          type="button"
          className={`color-palette-picker__swatch color-palette-picker__swatch--custom${
            customMode ? ' color-palette-picker__swatch--selected' : ''
          }`}
          aria-pressed={customMode}
          aria-label="Personalizado"
          title="Personalizado"
          onClick={selectCustomMode}
        >
          {customMode ? (
            <span aria-hidden="true" className="color-palette-picker__check">
              ✓
            </span>
          ) : (
            <span aria-hidden="true">+</span>
          )}
        </button>
      </div>

      {customMode ? (
        <label className="color-palette-picker__custom-row">
          <span className="visually-hidden">Elegir color personalizado</span>
          <input
            type="color"
            className="field__control color-palette-picker__custom-input"
            value={customValue}
            onChange={(event) => onChange(event.target.value)}
          />
          <span className="color-palette-picker__custom-value">{customValue.toUpperCase()}</span>
        </label>
      ) : null}

      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}
