// Lectura pública (sin auth) de la organización de un mes ya FINALIZED.
// Contrato cerrado: docs/architecture/phase5-public-page-contract.md §2.
// Los routers (routes/schedule.routes.js) solo parsean/validan/serializan;
// toda la lógica vive acá.
//
// La página pública muestra SOLO el mes finalizado más reciente (decisión
// confirmada con el usuario, ver contrato §0) -- no hay historial ni
// selector de meses anteriores.

import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../utils/errors.js";
import { getCached, setCached } from "../lib/cache.js";
import { TEAM_SELECT, serializeTeam } from "./teamGeneration.service.js";
import { SLOT_SELECT, serializeSlot } from "./scheduleGeneration.service.js";

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

  const [teams, slots] = await Promise.all([
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
  ]);

  const payload = {
    month: {
      year: monthCycle.year,
      month: monthCycle.month,
      finalizedAt: monthCycle.finalizedAt,
    },
    teams: teams.map(serializeTeam),
    slots: slots.map(serializeSlot),
  };

  setCached(cacheKey, payload, PUBLIC_CACHE_TTL_MS);
  return payload;
}

/**
 * @param {number} year
 * @param {number} month
 */
export async function getPublicScheduleFor(year, month) {
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
 * Mes FINALIZED más reciente por (year desc, month desc). Esta búsqueda NO
 * se cachea (consulta liviana sobre una tabla chica); una vez resuelto cuál
 * mes es, delega en buildPublicPayload, que sí está cacheado por mes.
 */
export async function getLatestPublicSchedule() {
  const monthCycle = await prisma.monthCycle.findFirst({
    where: { status: "FINALIZED" },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { id: true, year: true, month: true, status: true, finalizedAt: true },
  });

  if (!monthCycle) {
    throw new NotFoundError(PUBLIC_NOT_FOUND_MESSAGE, { code: "MES_NO_PUBLICADO" });
  }

  return buildPublicPayload(monthCycle);
}
