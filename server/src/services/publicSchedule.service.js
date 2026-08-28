// Lectura pública (sin auth) de la organización de un mes ya FINALIZED.
// Contrato cerrado: docs/architecture/phase5-public-page-contract.md §2.
// Los routers (routes/schedule.routes.js) solo parsean/validan/serializan;
// toda la lógica vive acá.
//
// La página pública muestra por defecto el mes finalizado "vigente" (GET
// /latest: el mes civil actual si está publicado, si no el más reciente
// hacia atrás -- NUNCA salta a un mes futuro ya finalizado por anticipado,
// ajustado 2026-08-22), y además permite consultar meses FINALIZED
// anteriores hasta PUBLIC_HISTORY_MONTHS de antigüedad (ajustado el
// 2026-08-22, revierte la decisión original de Fase 5 de "sin historial")
// vía GET /:year/:month y GET /history.

import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../utils/errors.js";
import { getCached, setCached } from "../lib/cache.js";
import { env } from "../config/env.js";
import { currentCivilDate, monthsBetween, daysInMonth } from "../utils/dates.js";
import { TEAM_SELECT, serializeTeam } from "./teamGeneration.service.js";
import { SLOT_SELECT, serializeSlot } from "./scheduleGeneration.service.js";

// Ventana del historial público: hasta 12 meses hacia atrás desde la fecha
// civil de hoy, inclusive (ej. hoy agosto 2026 -> permite hasta agosto 2025).
// Aplica a GET /:year/:month y GET /history, NO a GET /latest (que siempre
// muestra lo último publicado, sea cual sea su antigüedad). Ojo: el límite
// es SOLO hacia atrás -- un mes actual o futuro (ej. finalizado
// anticipadamente) nunca queda bloqueado por esta ventana, solo lo hacen los
// meses demasiado viejos.
const PUBLIC_HISTORY_MONTHS = 12;

function isWithinHistoryWindow(year, month) {
  const today = currentCivilDate(env.APP_TIMEZONE);
  const monthsAgo = monthsBetween({ year, month }, today);
  return monthsAgo <= PUBLIC_HISTORY_MONTHS;
}

// Parte 3 (wise-noodling-hickey.md): isWithinHistoryWindow de arriba solo
// limita hacia ATRÁS (monthsBetween da negativo para un mes futuro, que
// siempre es <= PUBLIC_HISTORY_MONTHS) -- por diseño, no por descuido, un mes
// futuro FINALIZED pasaba sin ninguna restricción, contrario a la intención
// original de "el default nunca salta a futuro" (getLatestPublicSchedule).
// Esta función tapa ese hueco para la consulta MANUAL de un mes puntual
// ("Ver otro mes"): el mes siguiente al actual se revela recién en los
// últimos 8 días (inclusive) del mes civil actual; cualquier mes 2+ meses en
// el futuro nunca se revela, sin importar el día.
function isNextMonthEarlyRevealed(year, month) {
  const today = currentCivilDate(env.APP_TIMEZONE);
  const nextMonth = today.month === 12 ? { year: today.year + 1, month: 1 } : { year: today.year, month: today.month + 1 };
  if (year !== nextMonth.year || month !== nextMonth.month) return false;

  const totalDaysThisMonth = daysInMonth(today.year, today.month);
  return today.day >= totalDaysThisMonth - 7;
}

/** true si (year, month) es estrictamente posterior al mes civil actual. */
function isStrictlyFuture(year, month) {
  const today = currentCivilDate(env.APP_TIMEZONE);
  return year > today.year || (year === today.year && month > today.month);
}

// Mensaje único a propósito: la página pública nunca debe permitir distinguir
// "el mes no existe" de "el mes existe pero sigue en DRAFT" (ver contrato §0).
const PUBLIC_NOT_FOUND_MESSAGE = "No hay ningún mes publicado para esa fecha.";

// Exportada (no solo interna) porque, desde Fase 4c, escrituras que caen
// fuera de este archivo (events.service.js, slots.service.js) pueden mutar
// un mes ya FINALIZED -y por lo tanto ya cacheado bajo esta clave- y
// necesitan invalidar puntualmente sin duplicar el formato de la clave.
export function cacheKeyFor(year, month) {
  return `schedule:${year}:${month}`;
}

// TTL de defensa en profundidad: un mes FINALIZED es inmutable por diseño
// (contrato §2) y la invalidación explícita (invalidateByPrefix("schedule:"))
// sigue siendo el mecanismo principal. El TTL solo acota a 60s la ventana de
// inconsistencia si la app llega a correr en más de un proceso (ej. Passenger
// con varios workers) y una invalidación disparada en un proceso no llega a
// los demás, que seguirían sirviendo el payload viejo indefinidamente sin él.
const PUBLIC_CACHE_TTL_MS = 60_000;

/**
 * Arma el payload público a partir de un MonthCycle ya confirmado FINALIZED.
 *
 * @param {{ id: string, year: number, month: number, finalizedAt: Date }} monthCycle
 */
export async function buildPublicPayload(monthCycle) {
  const cacheKey = cacheKeyFor(monthCycle.year, monthCycle.month);
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const [teams, slots, verses] = await Promise.all([
    prisma.team.findMany({
      where: { monthCycleId: monthCycle.id },
      orderBy: { orderIndex: "asc" },
      select: TEAM_SELECT,
    }),
    prisma.serviceSlot.findMany({
      where: { monthCycleId: monthCycle.id },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: SLOT_SELECT,
    }),
    // Parte 4 (wise-noodling-hickey.md): versículo(s) del mes, ya resueltos y
    // persistidos por verses.service.js -- la página pública nunca llama a
    // bibleSource.service.js directamente.
    prisma.versePassage.findMany({
      where: { monthCycleId: monthCycle.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, reference: true, text: true, version: true },
    }),
  ]);

  const payload = {
    month: {
      year: monthCycle.year,
      month: monthCycle.month,
      finalizedAt: monthCycle.finalizedAt,
    },
    teams: teams.map(serializeTeam),
    slots: slots.map(serializeSlot),
    verses: verses.map((v) => ({ id: v.id, reference: v.reference, text: v.text, version: v.version })),
  };

  setCached(cacheKey, payload, PUBLIC_CACHE_TTL_MS);
  return payload;
}

/**
 * @param {number} year
 * @param {number} month
 */
export async function getPublicScheduleFor(year, month) {
  // Fuera de la ventana de 1 año: mismo 404 genérico que "no existe"/"DRAFT"
  // -- nunca se distingue el motivo (regla de privacidad ya establecida).
  if (!isWithinHistoryWindow(year, month)) {
    throw new NotFoundError(PUBLIC_NOT_FOUND_MESSAGE, { code: "MES_NO_PUBLICADO" });
  }

  // Parte 3 (wise-noodling-hickey.md): un mes estrictamente futuro solo se
  // revela si es EXACTAMENTE el mes siguiente y estamos en sus últimos 8
  // días -- mismo 404 genérico si no, nunca se distingue el motivo.
  if (isStrictlyFuture(year, month) && !isNextMonthEarlyRevealed(year, month)) {
    throw new NotFoundError(PUBLIC_NOT_FOUND_MESSAGE, { code: "MES_NO_PUBLICADO" });
  }

  const monthCycle = await prisma.monthCycle.findUnique({
    where: { year_month: { year, month } },
    select: { id: true, year: true, month: true, status: true, finalizedAt: true },
  });

  if (!monthCycle || monthCycle.status !== "FINALIZED") {
    throw new NotFoundError(PUBLIC_NOT_FOUND_MESSAGE, { code: "MES_NO_PUBLICADO" });
  }

  return buildPublicPayload(monthCycle);
}

/**
 * Meses FINALIZED dentro de la ventana de historial pública (hasta
 * PUBLIC_HISTORY_MONTHS meses atrás desde hoy), para poblar el selector de
 * "ver un mes anterior" de la página pública. Mismo filtro `status:
 * "FINALIZED"` que getLatestPublicSchedule/getPublicScheduleFor -- nunca
 * incluye meses DRAFT, así que no revela su existencia.
 */
export async function listPublicScheduleHistory() {
  const monthCycles = await prisma.monthCycle.findMany({
    where: { status: "FINALIZED" },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { year: true, month: true },
  });
  return {
    months: monthCycles.filter((m) => {
      if (!isWithinHistoryWindow(m.year, m.month)) return false;
      // Parte 3: mismo filtro que getPublicScheduleFor -- un mes futuro solo
      // entra a la lista si ya se adelantó (últimos 8 días del mes actual).
      if (isStrictlyFuture(m.year, m.month) && !isNextMonthEarlyRevealed(m.year, m.month)) return false;
      return true;
    }),
  };
}

/**
 * Mes FINALIZED "vigente" por defecto: el mes civil actual si ya está
 * publicado, o si no, el más reciente hacia ATRÁS (nunca salta a un mes
 * futuro, aunque ya esté finalizado por anticipado -- ajustado 2026-08-22,
 * el admin puede publicar el mes siguiente antes de tiempo sin que eso
 * cambie lo que ve por defecto quien visita la página hoy). Esta búsqueda
 * NO se cachea (consulta liviana sobre una tabla chica); una vez resuelto
 * cuál mes es, delega en buildPublicPayload, que sí está cacheado por mes.
 */
export async function getLatestPublicSchedule() {
  const today = currentCivilDate(env.APP_TIMEZONE);
  const monthCycle = await prisma.monthCycle.findFirst({
    where: {
      status: "FINALIZED",
      OR: [{ year: { lt: today.year } }, { year: today.year, month: { lte: today.month } }],
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { id: true, year: true, month: true, status: true, finalizedAt: true },
  });

  if (!monthCycle) {
    throw new NotFoundError(PUBLIC_NOT_FOUND_MESSAGE, { code: "MES_NO_PUBLICADO" });
  }

  return buildPublicPayload(monthCycle);
}
