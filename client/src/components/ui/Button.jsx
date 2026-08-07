import './Button.css';

/**
 * Botón base de toda la app. Siempre renderiza un <button> semántico real
 * (nunca un div con onClick) para que el teclado y los lectores de pantalla
 * lo reconozcan sin ARIA adicional.
 *
 * @param {{
 *   variant?: 'primary'|'secondary'|'danger'|'ghost',
 *   size?: 'md'|'sm',
 *   type?: 'button'|'submit'|'reset',
 *   loading?: boolean,
 *   fullWidth?: boolean,
 * }} props
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  type = 'button',
  loading = false,
  fullWidth = false,
  disabled = false,
  className = '',
  ...rest
}) {
  const classes = ['btn', `btn--${variant}`, `btn--${size}`, fullWidth ? 'btn--full' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}
