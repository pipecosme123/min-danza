import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { AppHeader } from '../components/Layout/AppHeader.jsx';
import { AdminNav } from '../components/Layout/AdminNav.jsx';
import { Button } from '../components/ui/Button.jsx';

/**
 * Layout del panel de administración: encabezado + navegación por
 * secciones + el contenido de la sección activa vía <Outlet/>.
 *
 * Teléfono/tablet (< 1024px): la navegación es una barra inferior y la
 * sesión/tema pasan a la hoja «Más». Escritorio: menú lateral a la
 * izquierda del contenido y sesión/tema en el encabezado.
 */
export function AdminDashboard() {
  const { adminName, logout } = useAuth();

  return (
    <div className="admin-layout admin-layout--with-nav">
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>

      <AppHeader
        actionsDesktopOnly
        actions={
          <div className="admin-layout__session">
            {adminName ? <span className="admin-layout__admin-name">Hola, {adminName}</span> : null}
            <Button variant="secondary" size="sm" onClick={logout}>
              Cerrar sesión
            </Button>
          </div>
        }
      />

      <div className="container admin-layout__body">
        <AdminNav onLogout={logout} />

        <main id="main-content" className="admin-layout__main page-section">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
