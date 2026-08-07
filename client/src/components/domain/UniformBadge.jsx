import './UniformBadge.css';

/**
 * Chip de uniforme: color + nombre. El color es solo un refuerzo visual,
 * el nombre siempre está presente como texto (nunca solo un punto de
 * color sin etiqueta).
 *
 * @param {{ name: string, colorHex?: string|null }} props
 */
export function UniformBadge({ name, colorHex }) {
  return (
    <span className="uniform-badge">
      <span
        className="uniform-badge__swatch"
        style={{ backgroundColor: colorHex || 'var(--color-border-input)' }}
        aria-hidden="true"
      />
      {name}
    </span>
  );
}
