import { Link } from 'react-router-dom';
import { AppHeader } from '../components/Layout/AppHeader.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';

/**
 * Página pública, sin autenticación. En esta fase muestra únicamente el
 * estado "aún no hay mes publicado": la Fase 5 del plan agrega la consulta
 * real a `GET /api/schedule/:year/:month` y solo mostrará meses ya
 * `FINALIZED` (regla confirmada, ver CLAUDE.md).
 */
export function PublicSchedule() {
  return (
    <div>
      <a href="#main-content" className="skip-link">
        Saltar al contenido principal
      </a>

      <AppHeader />

      <main id="main-content" className="container page-section">
        <header className="page-header">
          <h1>Horario del mes</h1>
          <p className="page-header__description">
            Aquí vas a poder consultar los equipos, sus integrantes y los horarios asignados para el mes en
            curso, sin necesidad de iniciar sesión.
          </p>
        </header>

        <EmptyState
          title="Todavía no hay un mes publicado"
          description="El administrador publica el horario del mes una vez que los equipos y turnos quedan confirmados. Vuelve a consultar más tarde."
        />
      </main>

      <footer className="public-footer">
        <div className="container">
          <Link to="/admin/login" className="public-footer__admin-link">
            Acceso administrador
          </Link>
        </div>
      </footer>
    </div>
  );
}
