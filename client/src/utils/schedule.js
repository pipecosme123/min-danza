/**
 * Utilidades compartidas de horario. Hoy solo agrupa turnos por fecha civil
 * para armar los `groups` que espera `CalendarGrid` — usado tanto por
 * `EventsManager` (panel admin) como por `PublicSchedule` (página pública)
 * para no duplicar la misma lógica de agrupado.
 */
import { formatCivilDate } from './dates.js';

/**
 * Agrupa los turnos por fecha civil, en el mismo orden en que llegan (ya
 * vienen ordenados por fecha/hora desde el backend).
 * @param {Array<{ id: string, date: string }>} slots
 * @returns {Array<{ key: string, heading: string, slots: Array }>}
 */
export function groupSlotsByDate(slots) {
  const map = new Map();
  slots.forEach((slot) => {
    if (!map.has(slot.date)) map.set(slot.date, []);
    map.get(slot.date).push(slot);
  });
  return Array.from(map.entries()).map(([date, dateSlots]) => ({
    key: date,
    heading: formatCivilDate(date),
    slots: dateSlots,
  }));
}
