import './Badge.css';

/**
 * Etiqueta corta de estado o categoría (rol en el equipo, estado activo/
 * inactivo, tipo de evento). Siempre texto + color, nunca solo color, para
 * que el significado no dependa de distinguir tonos.
 *
 * @param {{ variant?: 'neutral'|'primary'|'success'|'danger'|'warning' }} props
 */
export function Badge({ children, variant = 'neutral' }) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}
