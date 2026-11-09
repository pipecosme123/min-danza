import { Link } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle.jsx';
import logoWhite from '../../assets/logo-principal-blanco.png';
import './AppHeader.css';

/**
 * Encabezado compartido (página pública, portal de líderes y panel de
 * administración): franja con el degradado de la propuesta A, logo blanco
 * en ambos temas (siempre va sobre el degradado) y las `actions` de cada
 * layout (ej. «Cerrar sesión»).
 *
 * `actionsDesktopOnly`: en el panel de administración, por debajo de 1024px
 * las acciones (sesión y tema) viven en la hoja «Más» de la barra inferior,
 * así que el encabezado las oculta para quedar limpio.
 *
 * @param {{ actions?: React.ReactNode, actionsDesktopOnly?: boolean }} props
 */
export function AppHeader({ actions, actionsDesktopOnly = false }) {
  return (
    <header className="app-header">
      <div className="container app-header__inner">
        <Link to="/" className="app-header__brand">
          <img
            src={logoWhite}
            alt="Iglesia Lluvias De Bendiciones — Cruzada Cristiana"
            className="app-header__logo"
          />
        </Link>

        <div
          className={`app-header__actions${actionsDesktopOnly ? ' app-header__actions--desktop-only' : ''}`}
        >
          {actions}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
