/**
 * Utilidades de formato de fecha/hora para la UI. Espejo liviano de
 * `server/src/utils/dates.js`: aquí solo formateamos para mostrar, el
 * cálculo de calendario (último domingo, último sábado, etc.) vive en el
 * backend. Reutilizado por `SlotCard`, `CalendarGrid` y `PublicSchedule`
 * para no repetir el formateo en cada uno.
 */

const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * @param {string|Date} dateInput Fecha civil, típicamente "YYYY-MM-DD" desde la API.
 * @returns {string} ej. "Domingo 3 de agosto"
 */
export function formatCivilDate(dateInput) {
  const date = typeof dateInput === 'string' ? new Date(`${dateInput}T00:00:00`) : dateInput;
  const weekday = WEEKDAY_LABELS[date.getDay()];
  const day = date.getDate();
  const month = date.toLocaleDateString('es-CO', { month: 'long' });
  return `${weekday} ${day} de ${month}`;
}

/**
 * @param {string} startTime Formato "HH:mm" 24h, ej. "18:50".
 * @returns {string} ej. "6:50 p. m."
 */
export function formatTimeLabel(startTime) {
  const [hoursStr, minutes] = startTime.split(':');
  const hours = parseInt(hoursStr, 10);
  const period = hours >= 12 ? 'p. m.' : 'a. m.';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${period}`;
}
