// Fase 9 · Ventana de registro de asistencia.
//
//   opensAt  = (fecha del turno + hora de inicio, en APP_TIMEZONE) − 1 hora
//   closesAt = fin del 3.º día calendario posterior (23:59:59.999, APP_TIMEZONE)
//   state    = now < opensAt  -> 'PENDIENTE'
//              now <= closesAt -> 'ABIERTA'
//              si no           -> 'CERRADA'
//
// `America/Bogota` no tiene horario de verano, pero el cálculo se hace
// tz-aware vía Intl.DateTimeFormat (mismo criterio que
// dates.js#currentCivilDate) para no clavar el offset. El resto de dates.js
// (aritmética de calendario SIN zona horaria) no se toca.
// Contrato: docs/architecture/phase9-attendance-reports-contract.md §4.4.

import { env } from "../config/env.js";
import { dbDateToCivilDate } from "../utils/dates.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Milisegundos que `timeZone` va por delante de UTC en el instante `date`.
 * El offset de una zona horaria es SIEMPRE un número entero de minutos, así
 * que se compara a nivel de segundo (truncando ambos lados) para no arrastrar
 * el error sub-segundo que `formatToParts` -- que no expone milisegundos --
 * introduciría al pasar una hora de pared con `.mmm` (p. ej. 23:59:59.999).
 * @param {Date} date
 * @param {string} timeZone
 */
function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  // "24" a medianoche en algunos runtimes de Node.
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  );
  // Ambos lados truncados al segundo: el resultado es un múltiplo exacto de
  // 60_000 (offset en minutos enteros), sin residuo de milisegundos.
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Instante UTC (Date) correspondiente a una hora de pared {year,month,day} +
 * "HH:mm[:ss[.mmm]]" en `timeZone`. Preserva segundos y milisegundos.
 * @param {{ year: number, month: number, day: number }} civil
 * @param {number} hour
 * @param {number} minute
 * @param {number} [second]
 * @param {number} [ms]
 * @param {string} [timeZone]
 */
export function civilWallTimeToInstant(civil, hour, minute, second = 0, ms = 0, timeZone = env.APP_TIMEZONE) {
  const naiveUTC = Date.UTC(civil.year, civil.month - 1, civil.day, hour, minute, second, ms);
  // Dos pasadas: la primera estima el offset, la segunda lo corrige en los
  // (inexistentes en Bogotá) bordes de DST. `naiveUTC - offset` conserva el
  // `.mmm` original porque `offset` es siempre minutos enteros.
  let offset = tzOffsetMs(new Date(naiveUTC), timeZone);
  offset = tzOffsetMs(new Date(naiveUTC - offset), timeZone);
  return new Date(naiveUTC - offset);
}

/** Suma `n` días de calendario a una fecha civil {year,month,day}. */
function addCivilDays(civil, n) {
  const d = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * @param {Date} slotDate  `ServiceSlot.date` tal cual vuelve de Prisma (@db.Date, medianoche UTC).
 * @param {string} startTime  "HH:mm" 24h.
 * @param {Date} [now]
 * @returns {{ opensAt: Date, closesAt: Date, state: 'PENDIENTE' | 'ABIERTA' | 'CERRADA' }}
 */
export function computeAttendanceWindow(slotDate, startTime, now = new Date()) {
  const civil = dbDateToCivilDate(slotDate);
  const [h, m] = String(startTime).split(":").map(Number);

  const serviceStart = civilWallTimeToInstant(civil, h, m);
  const opensAt = new Date(serviceStart.getTime() - HOUR_MS);

  const closeCivil = addCivilDays(civil, 3);
  const closesAt = civilWallTimeToInstant(closeCivil, 23, 59, 59, 999);

  let state;
  if (now.getTime() < opensAt.getTime()) state = "PENDIENTE";
  else if (now.getTime() <= closesAt.getTime()) state = "ABIERTA";
  else state = "CERRADA";

  return { opensAt, closesAt, state };
}

/** true si la ventana permite registrar (crear/editar/enviar/reabrir por el líder). */
export function isWindowOpen(slotDate, startTime, now = new Date()) {
  return computeAttendanceWindow(slotDate, startTime, now).state === "ABIERTA";
}

export { DAY_MS };
