import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';

/**
 * Placeholder de Fase 1. La lógica real (elegir el mes, sortear equipos,
 * re-sortear, editar manualmente) llega en la Fase 3 del plan.
 */
export function TeamGenerator() {
  return (
    <div>
      <header className="page-header">
        <h1>Equipos</h1>
        <p className="page-header__description">
          Aquí se sortean los equipos del mes (líder, apoyo y colaboradores) y se pueden ajustar manualmente
          antes de publicar. Los equipos se forman una sola vez al mes y luego rotan de horario.
        </p>
      </header>

      <EmptyState
        title="Todavía no hay un mes en curso"
        description="Primero carga personas en la sección «Personas» y, cuando el servidor esté disponible, crea un mes para poder sortear los equipos."
        action={
          <Link to="/admin/personas">
            <Button variant="secondary">Ir a Personas</Button>
          </Link>
        }
      />
    </div>
  );
}
