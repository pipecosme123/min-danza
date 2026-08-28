import { formatTimeLabel } from '../../utils/dates.js';
import { getSlotEventGroup } from '../../utils/schedule.js';
import { UniformBadge } from './UniformBadge.jsx';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import './SlotCard.css';
import './ScheduleSlotCard.css';

const SLOT_TYPE_LABELS = {
  FIXED: 'Turno fijo',
  EXTRAORDINARY: 'Evento extraordinario',
  YOUTH_SERVICE: 'Servicio de jóvenes',
};

/**
 * Variante administrativa de `SlotCard`: mismo lenguaje visual (reutiliza
 * sus clases CSS), pero cada equipo asignado trae controles para bloquear/
 * desbloquear la asignación y reasignar el equipo a mano, un selector para
 * elegir el uniforme de este turno puntual, y el slot en su conjunto puede
 * ofrecer "Editar evento"/"Cancelar evento"/"Eliminar evento" cuando es
 * `EXTRAORDINARY`.
 *
 * No reemplaza a `SlotCard` (que sigue siendo la tarjeta de solo lectura de
 * la página pública): esta es la variante editable que consume
 * `EventsManager` a través del `renderSlot` de `CalendarGrid`.
 *
 * Dos props de deshabilitado, cada uno atado a un grupo distinto de la
 * tabla de `docs/architecture/phase4c-post-publish-edits-contract.md` §0:
 * - `disabled`: bloquear/desbloquear, reasignar equipo, "Editar evento"
 *   completo. Atado a `monthIsPast` (mes finalizado Y ya pasado) — un mes
 *   finalizado que todavía es el actual o uno futuro deja estas acciones
 *   habilitadas.
 * - `eventActionsDisabled`: agregar (fuera de esta tarjeta)/cancelar
 *   evento o Servicio de jóvenes/eliminar evento, y el selector de
 *   uniforme del turno. Atado también a `monthIsPast`, mismo criterio.
 *
 * @param {{
 *   slot: Object,
 *   regularTeams: Array<{ id: string, label: string }>,
 *   uniforms: Array<{ id: string, name: string }>,
 *   disabled?: boolean,
 *   eventActionsDisabled?: boolean,
 *   busyAssignmentId?: string|null,
 *   uniformBusy?: boolean,
 *   onToggleLock: (assignmentId: string, locked: boolean) => void,
 *   onReassign: (assignmentId: string, teamId: string) => void,
 *   onUniformChange?: (slot: Object, uniformId: string|null) => void,
 *   onDeleteEvent?: (slot: Object) => void,
 *   onEditEvent?: (slot: Object) => void,
 *   onCancelEvent?: (slot: Object) => void,
 * }} props
 */
export function ScheduleSlotCard({
  slot,
  regularTeams,
  uniforms = [],
  disabled = false,
  eventActionsDisabled = false,
  busyAssignmentId = null,
  uniformBusy = false,
  onToggleLock,
  onReassign,
  onUniformChange,
  onDeleteEvent,
  onEditEvent,
  onCancelEvent,
}) {
  const isCancelled = Boolean(slot.cancelledAt);
  const eventGroup = getSlotEventGroup(slot);
  const canReassign = slot.slotType !== 'YOUTH_SERVICE';
  // Un turno que pertenece a un evento agrupado (Congreso, etc.) no ofrece
  // las acciones de evento suelto: se edita/cancela/elimina desde la
  // sección de eventos agrupados, que opera sobre el grupo completo o sobre
  // este turno puntual con sus propios endpoints.
  const canDelete = slot.slotType === 'EXTRAORDINARY' && Boolean(onDeleteEvent) && !eventGroup;
  // "Editar evento" completo y "Cancelar evento" no tienen sentido sobre un
  // evento ya cancelado: no queda nada que gestionar salvo "Eliminar
  // evento", que sigue disponible para purgarlo del todo.
  const canEdit = slot.slotType === 'EXTRAORDINARY' && Boolean(onEditEvent) && !isCancelled && !eventGroup;
  // Cancelar admite EXTRAORDINARY y YOUTH_SERVICE (eliminar el equipo YOUTH
  // completo se hace desde «Equipos», no acá).
  const canCancel =
    (slot.slotType === 'EXTRAORDINARY' || slot.slotType === 'YOUTH_SERVICE') &&
    Boolean(onCancelEvent) &&
    !isCancelled &&
    !eventGroup;
  const cancelLabel = slot.slotType === 'YOUTH_SERVICE' ? 'Cancelar Servicio de jóvenes' : 'Cancelar evento';

  return (
    <article className="slot-card schedule-slot-card">
      <header className="slot-card__header">
        {/* La fecha ya la dice el subtítulo del grupo en CalendarGrid, no hace falta repetirla acá. */}
        <p className="slot-card__time">{formatTimeLabel(slot.startTime)}</p>
        <span className="slot-card__type">{SLOT_TYPE_LABELS[slot.slotType] || slot.slotType}</span>
      </header>

      {eventGroup ? <Badge variant="primary">{eventGroup.title || 'Evento agrupado'}</Badge> : null}

      {slot.title ? (
        <p className={isCancelled ? 'slot-card__title slot-card__title--cancelled' : 'slot-card__title'}>
          {slot.title}
        </p>
      ) : null}

      {isCancelled ? <Badge variant="danger">Cancelado</Badge> : null}

      {isCancelled ? (
        <p className="slot-card__no-team">Este evento fue cancelado.</p>
      ) : slot.teams && slot.teams.length > 0 ? (
        <ul className="schedule-slot-card__team-list">
          {slot.teams.map((team) => {
            const isBusy = busyAssignmentId === team.assignmentId;
            return (
              <li key={team.assignmentId} className="schedule-slot-card__team-row">
                {canReassign ? (
                  <label className="schedule-slot-card__team-select-label">
                    <span className="visually-hidden">Equipo asignado a este turno</span>
                    <select
                      className="field__control schedule-slot-card__team-select"
                      value={team.id}
                      disabled={disabled || isBusy}
                      onChange={(event) => onReassign(team.assignmentId, event.target.value)}
                    >
                      {regularTeams.map((rt) => (
                        <option key={rt.id} value={rt.id}>
                          {rt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="schedule-slot-card__team-name">{team.label}</span>
                )}

                {team.locked ? <Badge variant="neutral">Bloqueada</Badge> : null}

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={disabled || isBusy}
                  onClick={() => onToggleLock(team.assignmentId, team.locked)}
                >
                  {team.locked ? 'Desbloquear' : 'Bloquear'}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="slot-card__no-team">Sin equipo asignado todavía.</p>
      )}

      {!isCancelled && onUniformChange ? (
        <label className="schedule-slot-card__uniform-row">
          <span className="field__label">Uniforme de este turno</span>
          <select
            className="field__control"
            value={slot.uniform?.id ?? ''}
            disabled={eventActionsDisabled || uniformBusy}
            onChange={(event) => onUniformChange(slot, event.target.value || null)}
          >
            <option value="">Sin uniforme</option>
            {uniforms.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      ) : !isCancelled && slot.uniform ? (
        <UniformBadge name={slot.uniform.name} colorHex={slot.uniform.colorHex} />
      ) : null}

      {canEdit || canCancel || canDelete ? (
        <div className="schedule-slot-card__footer">
          {canEdit ? (
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => onEditEvent(slot)}>
              Editar evento
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={eventActionsDisabled}
              onClick={() => onCancelEvent(slot)}
            >
              {cancelLabel}
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={eventActionsDisabled}
              onClick={() => onDeleteEvent(slot)}
            >
              Eliminar evento
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
