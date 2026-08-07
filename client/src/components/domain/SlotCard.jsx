import { formatCivilDate, formatTimeLabel } from '../../utils/dates.js';
import { UniformBadge } from './UniformBadge.jsx';
import './SlotCard.css';

const SLOT_TYPE_LABELS = {
  FIXED: 'Turno fijo',
  EXTRAORDINARY: 'Evento extraordinario',
  SPECIAL: 'Evento especial',
};

/**
 * Tarjeta de un turno/evento con el o los equipos asignados. Unidad visual
 * base de `CalendarGrid` en la página pública y de los listados de
 * `EventsManager`/`SpecialSaturdayManager`.
 *
 * @param {{
 *   slot: {
 *     date: string, startTime: string, slotType: 'FIXED'|'EXTRAORDINARY'|'SPECIAL',
 *     title?: string, teamsNeeded: number,
 *     uniform?: { name: string, colorHex?: string } | null,
 *     teams: Array<{ id: string, label: string }>,
 *   },
 * }} props
 */
export function SlotCard({ slot }) {
  return (
    <article className="slot-card">
      <header className="slot-card__header">
        <p className="slot-card__datetime">
          {formatCivilDate(slot.date)} · {formatTimeLabel(slot.startTime)}
        </p>
        <span className="slot-card__type">{SLOT_TYPE_LABELS[slot.slotType] || slot.slotType}</span>
      </header>

      {slot.title ? <p className="slot-card__title">{slot.title}</p> : null}

      <div className="slot-card__teams">
        {slot.teams && slot.teams.length > 0 ? (
          <ul className="slot-card__team-list">
            {slot.teams.map((team) => (
              <li key={team.id}>{team.label}</li>
            ))}
          </ul>
        ) : (
          <p className="slot-card__no-team">Sin equipo asignado todavía.</p>
        )}
      </div>

      {slot.uniform ? <UniformBadge name={slot.uniform.name} colorHex={slot.uniform.colorHex} /> : null}
    </article>
  );
}
