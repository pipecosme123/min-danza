import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { AppHeader } from '../components/Layout/AppHeader.jsx';
import { NavTabs } from '../components/Layout/NavTabs.jsx';
import { Button } from '../components/ui/Button.jsx';

/**
 * Layout del panel de administración: encabezado + navegación por
 * secciones + el contenido de la sección activa vía <Outlet/>.
 */
export function AdminDashboard() {
  const { adminName, logout } = useAuth();

  return (
    <div className="admin-layout">
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>

      <AppHeader
        actions={
          <div className="admin-layout__session">
            {adminName ? <span className="admin-layout__admin-name">Hola, {adminName}</span> : null}
            <Button variant="secondary" size="sm" onClick={logout}>
              Cerrar sesión
            </Button>
          </div>
        }
      />

      <NavTabs />

      <main id="main-content" className="container page-section">
        <Outlet />
      </main>
    </div>
  );
}
