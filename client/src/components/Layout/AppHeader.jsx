import { Link } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle.jsx';
import './AppHeader.css';

/**
 * Encabezado compartido entre la página pública y el panel de
 * administración: mismo sistema de diseño en ambas, solo cambian las
 * `actions` (ej. botón de "Cerrar sesión" en el panel).
 *
 * @param {{ actions?: React.ReactNode }} props
 */
export function AppHeader({ actions }) {
  return (
    <header className="app-header">
      <div className="container app-header__inner">
        <Link to="/" className="app-header__brand">
          Equipos y Turnos
        </Link>

        <div className="app-header__actions">
          {actions}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
