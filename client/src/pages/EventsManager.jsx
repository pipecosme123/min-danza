import { EmptyState } from '../components/ui/EmptyState.jsx';

/**
 * Placeholder de Fase 1. La creación de eventos extraordinarios y su
 * asignación automática de equipos llegan en la Fase 4 del plan.
 */
export function EventsManager() {
  return (
    <div>
      <header className="page-header">
        <h1>Eventos extraordinarios</h1>
        <p className="page-header__description">
          Crea aquí eventos fuera de los turnos fijos (fecha, hora y cuántos equipos se necesitan). El sistema
          asignará automáticamente los equipos que mantengan el balance de participaciones del mes.
        </p>
      </header>

      <EmptyState
        title="Todavía no hay eventos extraordinarios"
        description="Esta sección se habilitará por completo cuando haya un mes en curso y el servidor esté conectado."
      />
    </div>
  );
}
