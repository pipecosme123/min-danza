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

/**
 * Un turno de un evento agrupado (Congreso, etc.) es, por dentro, un
 * `ServiceSlot` normal con `eventGroupId`/datos del grupo. El backend puede
 * mandar esa referencia como `eventGroupId`/`eventGroupTitle` sueltos o como
 * un objeto anidado `group: { id, title }` — esta función normaliza ambas
 * formas para que `ScheduleSlotCard`/`SlotCard` no tengan que conocer el
 * detalle exacto del DTO.
 * @param {{ eventGroupId?: string|null, eventGroupTitle?: string|null, group?: { id: string, title: string } | null }} slot
 * @returns {{ id: string, title: string|null } | null}
 */
export function getSlotEventGroup(slot) {
  if (!slot) return null;
  if (slot.group && slot.group.id) return slot.group;
  if (slot.eventGroupId) return { id: slot.eventGroupId, title: slot.eventGroupTitle ?? null };
  return null;
}
