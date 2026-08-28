import { formatTimeLabel } from '../../utils/dates.js';
import { getSlotEventGroup } from '../../utils/schedule.js';
import { UniformBadge } from './UniformBadge.jsx';
import { Badge } from '../ui/Badge.jsx';
import './SlotCard.css';

// Solo EXTRAORDINARY muestra su etiqueta de categoría en la página pública:
// "Turno fijo" y "Servicio de jóvenes" quedan implícitos por el título/hora
// del turno, no hace falta rotularlos aparte (pedido explícito del usuario).
const SLOT_TYPE_LABELS = {
  EXTRAORDINARY: 'Evento extraordinario',
};

/**
 * Tarjeta de un turno/evento con el o los equipos asignados. Unidad visual
 * base de `CalendarGrid` en la página pública y en `EventsManager`
 * (a través de `ScheduleSlotCard`, la variante editable del panel admin).
 *
 * @param {{
 *   slot: {
 *     date: string, startTime: string, slotType: 'FIXED'|'EXTRAORDINARY'|'YOUTH_SERVICE',
 *     title?: string, teamsNeeded: number,
 *     uniform?: { name: string, colorHex?: string } | null,
 *     teams: Array<{ id: string, label: string }>,
 *     cancelledAt?: string | null,
 *   },
 * }} props
 */
export function SlotCard({ slot }) {
  const isCancelled = Boolean(slot.cancelledAt);
  const eventGroup = getSlotEventGroup(slot);

  return (
    <article className="slot-card">
      {/* 1º: equipo — la fecha ya la dice el subtítulo del grupo en CalendarGrid, no hace falta repetirla acá. */}
      <div className="slot-card__teams">
        {isCancelled ? (
          <p className="slot-card__no-team">Este evento fue cancelado.</p>
        ) : slot.teams && slot.teams.length > 0 ? (
          <ul className="slot-card__team-list">
            {slot.teams.map((team) => (
              <li key={team.id}>{team.label}</li>
            ))}
          </ul>
        ) : (
          <p className="slot-card__no-team">Sin equipo asignado todavía.</p>
        )}
      </div>

      {/* 2º: solo la hora. */}
      <p className="slot-card__time">{formatTimeLabel(slot.startTime)}</p>

      <header className="slot-card__header">
        {SLOT_TYPE_LABELS[slot.slotType] ? (
          <span className="slot-card__type">{SLOT_TYPE_LABELS[slot.slotType]}</span>
        ) : null}
        {eventGroup ? <Badge variant="primary">{eventGroup.title || 'Evento agrupado'}</Badge> : null}
        {isCancelled ? <Badge variant="danger">Cancelado</Badge> : null}
      </header>

      {slot.title ? (
        <p className={isCancelled ? 'slot-card__title slot-card__title--cancelled' : 'slot-card__title'}>
          {slot.title}
        </p>
      ) : null}

      {!isCancelled && slot.uniform ? <UniformBadge name={slot.uniform.name} colorHex={slot.uniform.colorHex} /> : null}
    </article>
  );
}
