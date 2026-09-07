import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useLeaderAuth } from '../../context/LeaderAuthContext.jsx';
import { AppHeader } from '../../components/Layout/AppHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import './leader.css';

/**
 * Layout del portal de líderes: encabezado + sesión + contenido de la ruta.
 * Mientras la cuenta tenga `mustChangePassword`, todo se redirige a
 * `/lider/clave` salvo esa misma ruta (gate espejo del `requirePasswordChanged`
 * del backend).
 */
export function LeaderLayout() {
  const { leaderName, mustChangePassword, logout } = useLeaderAuth();
  const location = useLocation();

  const onChangePasswordRoute = location.pathname === '/lider/clave';
  if (mustChangePassword && !onChangePasswordRoute) {
    return <Navigate to="/lider/clave" replace />;
  }

  return (
    <div className="admin-layout">
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>

      <AppHeader
        actions={
          <div className="admin-layout__session">
            {leaderName ? <span className="admin-layout__admin-name">Hola, {leaderName}</span> : null}
            <Button variant="secondary" size="sm" onClick={logout}>
              Cerrar sesión
            </Button>
          </div>
        }
      />

      <main id="main-content" className="container page-section">
        <Outlet />
      </main>
    </div>
  );
}
