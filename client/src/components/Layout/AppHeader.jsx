import { Link } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import logoBlack from '../../assets/logo-principal-negro.png';
import logoWhite from '../../assets/logo-principal-blanco.png';
import './AppHeader.css';

/**
 * Encabezado compartido entre la página pública y el panel de
 * administración: mismo sistema de diseño en ambas, solo cambian las
 * `actions` (ej. botón de "Cerrar sesión" en el panel).
 *
 * @param {{ actions?: React.ReactNode }} props
 */
export function AppHeader({ actions }) {
  const { theme } = useTheme();
  const logo = theme === 'dark' ? logoWhite : logoBlack;

  return (
    <header className="app-header">
      <div className="container app-header__inner">
        <Link to="/" className="app-header__brand">
          <img
            src={logo}
            alt="Iglesia Lluvias De Bendiciones — Cruzada Cristiana"
            className="app-header__logo"
          />
        </Link>

        <div className="app-header__actions">
          {actions}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
