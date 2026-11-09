import { useTheme } from '../../context/ThemeContext.jsx';
import './ThemeToggle.css';

/**
 * Control de tema claro/oscuro. Siempre tiene texto (no solo un ícono de
 * sol/luna) para que su función sea clara sin tener que interpretar un
 * símbolo ambiguo; en el encabezado del teléfono el texto queda solo para
 * lectores de pantalla (ver AppHeader.css).
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button type="button" className="theme-toggle" onClick={toggleTheme} aria-pressed={isDark}>
      <span className="theme-toggle__icon" aria-hidden="true">
        {isDark ? '🌙' : '☀️'}
      </span>
      <span className="theme-toggle__label">{isDark ? 'Tema oscuro' : 'Tema claro'}</span>
    </button>
  );
}
