import { formatCivilDate, formatTimeLabel } from '../../utils/dates.js';
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
 * ofrecer "Editar evento"/"Eliminar evento" cuando es `EXTRAORDINARY`.
 *
 * No reemplaza a `SlotCard` (que sigue siendo la tarjeta de solo lectura de
 * la página pública): esta es la variante editable que consume
 * `EventsManager` a través del `renderSlot` de `CalendarGrid`.
 *
 * @param {{
 *   slot: Object,
 *   regularTeams: Array<{ id: string, label: string }>,
 *   uniforms: Array<{ id: string, name: string }>,
 *   disabled?: boolean,
 *   busyAssignmentId?: string|null,
 *   uniformBusy?: boolean,
 *   onToggleLock: (assignmentId: string, locked: boolean) => void,
 *   onReassign: (assignmentId: string, teamId: string) => void,
 *   onUniformChange?: (slot: Object, uniformId: string|null) => void,
 *   onDeleteEvent?: (slot: Object) => void,
 *   onEditEvent?: (slot: Object) => void,
 * }} props
 */
export function ScheduleSlotCard({
  slot,
  regularTeams,
  uniforms = [],
  disabled = false,
  busyAssignmentId = null,
  uniformBusy = false,
  onToggleLock,
  onReassign,
  onUniformChange,
  onDeleteEvent,
  onEditEvent,
}) {
  const canReassign = slot.slotType !== 'YOUTH_SERVICE';
  const canDelete = slot.slotType === 'EXTRAORDINARY' && Boolean(onDeleteEvent);
  const canEdit = slot.slotType === 'EXTRAORDINARY' && Boolean(onEditEvent);

  return (
    <article className="slot-card schedule-slot-card">
      <header className="slot-card__header">
        <p className="slot-card__datetime">
          {formatCivilDate(slot.date)} · {formatTimeLabel(slot.startTime)}
        </p>
        <span className="slot-card__type">{SLOT_TYPE_LABELS[slot.slotType] || slot.slotType}</span>
      </header>

      {slot.title ? <p className="slot-card__title">{slot.title}</p> : null}

      {slot.teams && slot.teams.length > 0 ? (
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

      {onUniformChange ? (
        <label className="schedule-slot-card__uniform-row">
          <span className="field__label">Uniforme de este turno</span>
          <select
            className="field__control"
            value={slot.uniform?.id ?? ''}
            disabled={disabled || uniformBusy}
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
      ) : slot.uniform ? (
        <UniformBadge name={slot.uniform.name} colorHex={slot.uniform.colorHex} />
      ) : null}

      {canEdit || canDelete ? (
        <div className="schedule-slot-card__footer">
          {canEdit ? (
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => onEditEvent(slot)}>
              Editar evento
            </Button>
          ) : null}
          {canDelete ? (
            <Button type="button" variant="danger" size="sm" disabled={disabled} onClick={() => onDeleteEvent(slot)}>
              Eliminar evento
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
