import { SlotCard } from './SlotCard.jsx';
import './CalendarGrid.css';

/**
 * Agrupa y presenta los turnos/eventos del mes (típicamente agrupados por
 * día). No asume cómo se renderiza cada turno: por defecto usa `SlotCard`,
 * pero acepta `renderSlot` para que otra pantalla reutilice el layout con
 * una tarjeta distinta (principio Open/Closed).
 *
 * @param {{
 *   groups: Array<{ key: string, heading: string, slots: Array }>,
 *   renderSlot?: (slot: any) => React.ReactNode,
 * }} props
 */
export function CalendarGrid({ groups, renderSlot }) {
  return (
    <div className="calendar-grid">
      {groups.map((group) => (
        <section key={group.key} className="calendar-grid__group" aria-labelledby={`calendar-group-${group.key}`}>
          <h3 id={`calendar-group-${group.key}`} className="calendar-grid__heading">
            {group.heading}
          </h3>
          <div className="calendar-grid__slots">
            {group.slots.map((slot) => (
              <div key={slot.id}>{renderSlot ? renderSlot(slot) : <SlotCard slot={slot} />}</div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
