// Utilidades de fecha civil. TODO cálculo de calendario (último domingo del
// mes, último sábado del mes, qué días de la semana caen en el mes) pasa por
// aquí — ningún service debe reimplementar esta aritmética.
//
// Deliberadamente trabajamos con fechas CIVILES (año/mes/día), no con
// timestamps con zona horaria: el dominio entero razona en "el último
// domingo de marzo", nunca en un instante UTC. Usamos Date.UTC() como una
// calculadora de calendario proléptico (no representa un instante real);
// esto evita el desfase de un día que introduciría convertir a
// America/Bogota y de vuelta. La zona horaria (`APP_TIMEZONE`) importa para
// **mostrar** fechas/horas al usuario, no para esta aritmética de calendario.
//
// Aún no se usa en ningún service (eso es Fase 3-4: scheduleGeneration).

/** 0=domingo … 6=sábado, igual que Date#getUTCDay(). */
const SUNDAY = 0;
const SATURDAY = 6;

function daysInMonth(year, month) {
  // month: 1-12. Día 0 del mes siguiente = último día del mes actual.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Devuelve la fecha civil (year, month, day) del último día de `weekday`
 * (0=domingo…6=sábado) en el mes dado.
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} weekday 0-6
 * @returns {{ year: number, month: number, day: number }}
 */
function lastWeekdayOf(year, month, weekday) {
  const lastDay = daysInMonth(year, month);
  for (let day = lastDay; day >= lastDay - 6; day -= 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCDay() === weekday) {
      return { year, month, day };
    }
  }
  // Inalcanzable: siempre hay un día de cada weekday en los últimos 7 días.
  throw new Error(`No se pudo calcular el último weekday=${weekday} de ${year}-${month}`);
}

/** Último domingo del mes (year, month 1-12). */
export function lastSundayOf(year, month) {
  return lastWeekdayOf(year, month, SUNDAY);
}

/** Último sábado del mes (year, month 1-12). */
export function lastSaturdayOf(year, month) {
  return lastWeekdayOf(year, month, SATURDAY);
}

/**
 * Todas las fechas civiles del mes que caen en `weekday` (0-6).
 * @returns {{ year: number, month: number, day: number }[]} en orden ascendente
 */
export function weekdaysIn(year, month, weekday) {
  const lastDay = daysInMonth(year, month);
  const result = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCDay() === weekday) {
      result.push({ year, month, day });
    }
  }
  return result;
}

/** Compara si dos fechas civiles {year,month,day} son el mismo día. */
export function isSameCivilDate(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Formatea {year,month,day} como "YYYY-MM-DD" (compatible con @db.Date). */
export function formatCivilDate({ year, month, day }) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Formatea un valor `ServiceSlot.date` tal cual vuelve del cliente Prisma
 * (un JS Date en medianoche UTC, por @db.Date) como "YYYY-MM-DD". Usa los
 * getters UTC a propósito — los locales introducirían el mismo desfase de un
 * día que el resto de este archivo evita (ver comentario de cabecera).
 */
export function formatDbDate(date) {
  return formatCivilDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

/** Normaliza "H:mm" o "HH:mm" a "HH:mm" cero-padded (formato de ServiceSlot.startTime). */
export function formatTime(hour, minute) {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${hh}:${mm}`;
}
