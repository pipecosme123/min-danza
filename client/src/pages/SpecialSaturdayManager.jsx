import { EmptyState } from '../components/ui/EmptyState.jsx';

/**
 * Placeholder de Fase 1. El roster manual del evento especial del último
 * sábado (que no cuenta en el balance del mes) llega en la Fase 4 del plan.
 */
export function SpecialSaturdayManager() {
  return (
    <div>
      <header className="page-header">
        <h1>Sábado especial</h1>
        <p className="page-header__description">
          El último sábado del mes (6:50 p. m.) tiene un equipo aparte que eliges manualmente, persona por
          persona. No cuenta dentro del balance de participaciones y no excluye a nadie de su equipo regular.
        </p>
      </header>

      <EmptyState
        title="Todavía no hay un evento del último sábado"
        description="Esta sección se habilitará por completo cuando haya un mes en curso y el servidor esté conectado."
      />
    </div>
  );
}
