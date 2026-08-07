import { useTheme } from '../../context/ThemeContext.jsx';
import './ThemeToggle.css';

/**
 * Control de tema claro/oscuro. Siempre muestra texto (no solo un ícono de
 * sol/luna) para que su función sea clara sin tener que interpretar un
 * símbolo ambiguo.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-pressed={isDark}
    >
      <span className="theme-toggle__icon" aria-hidden="true">
        {isDark ? '🌙' : '☀️'}
      </span>
      {isDark ? 'Tema oscuro' : 'Tema claro'}
    </button>
  );
}
