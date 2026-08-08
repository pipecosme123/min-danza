// Generación del horario mensual (turnos fijos + Servicio de jóvenes) y
// lectura del horario ya generado con su balance. Contrato cerrado:
// docs/architecture/phase4-schedule-contract.md §2, §3 y §8.
// Los routers (routes/months.routes.js, routes/events.routes.js) solo
// parsean/validan/serializan; toda regla vive acá.

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { weekdaysIn, lastSundayOf, lastSaturdayOf, isSameCivilDate, formatCivilDate, formatDbDate } from "../utils/dates.js";
import { recomputeBalance } from "./balance.service.js";

// Compartido con events.service.js: la respuesta de un ServiceSlot tiene
// siempre el mismo shape, la crea generate-schedule o un evento suelto.
export const SLOT_SELECT = {
  id: true,
  date: true,
  startTime: true,
  slotType: true,
  title: true,
  teamsNeeded: true,
  countsTowardBalance: true,
  uniform: { select: { id: true, name: true, colorHex: true } },
  assignments: {
    orderBy: { slotIndex: "asc" },
    select: { id: true, locked: true, team: { select: { id: true, label: true } } },
  },
};

// NOTA (ambigüedad resuelta, no explícita en el contrato de Fase 4 §2/§8):
// el shape documentado de `teams` es solo { id, label } del Team, pero
// PATCH /api/assignments/:id opera sobre el id de la SlotAssignment, no del
// Team, y ningún otro endpoint lo expone. Sin esto, el frontend descrito en
// el contrato §10 (bloquear/desbloquear, reasignar por SlotAssignment) sería
// irrealizable. Se agrega `assignmentId` y `locked` de forma aditiva (no se
// quita nada de lo documentado).
export function serializeSlot(slot) {
  return {
    id: slot.id,
    date: formatDbDate(slot.date),
    startTime: slot.startTime,
    slotType: slot.slotType,
    title: slot.title,
    teamsNeeded: slot.teamsNeeded,
    countsTowardBalance: slot.countsTowardBalance,
    uniform: slot.uniform ? { id: slot.uniform.id, name: slot.uniform.name, colorHex: slot.uniform.colorHex } : null,
    teams: slot.assignments.map((a) => ({
      id: a.team.id,
      label: a.team.label,
      assignmentId: a.id,
      locked: a.locked,
    })),
  };
}

function toDbDate(civilDate) {
  // "YYYY-MM-DD" parseado por el motor JS como medianoche UTC (fecha ISO sin
  // hora) — coherente con el resto de este módulo, ver utils/dates.js.
  return new Date(formatCivilDate(civilDate));
}

function assertDraft(month) {
  if (month.status !== "DRAFT") {
    throw new ConflictError("El mes ya está finalizado y no admite cambios.", { code: "MES_FINALIZADO" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/months/:id/generate-schedule
// ---------------------------------------------------------------------------

/**
 * @param {string} monthCycleId
 * @param {{ regenerate?: boolean }} [options]
 */
export async function generateSchedule(monthCycleId, { regenerate = false } = {}) {
  return prisma.$transaction(async (tx) => {
    const month = await tx.monthCycle.findUnique({ where: { id: monthCycleId } });
    if (!month) throw new NotFoundError("Mes no encontrado.");
    assertDraft(month);

    const regularTeamCount = await tx.team.count({ where: { monthCycleId, teamType: "REGULAR" } });
    if (regularTeamCount === 0) {
      throw new ConflictError("El mes todavía no tiene equipos generados; no se puede armar el horario.", {
        code: "EQUIPOS_NO_GENERADOS",
      });
    }

    const existingSlotCount = await tx.serviceSlot.count({ where: { monthCycleId } });

    if (existingSlotCount > 0 && !regenerate) {
      // Llamada idempotente: devuelve el horario existente tal cual está,
      // sin tocar nada (evita que una doble-carga del form rompa algo).
      const slots = await tx.serviceSlot.findMany({
        where: { monthCycleId },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        select: SLOT_SELECT,
      });
      return { slots: slots.map(serializeSlot), warnings: [] };
    }

    if (existingSlotCount > 0 && regenerate) {
      // Cascada borra sus SlotAssignment. Los EXTRAORDINARY que el admin
      // haya creado a mano también se pierden a propósito (ver contrato §2).
      await tx.serviceSlot.deleteMany({ where: { monthCycleId } });
    }

    const warnings = [];

    const [weekdayWed, weekdaySun, youthTeam, youthUniformRow] = await Promise.all([
      tx.weekdayUniform.findUnique({ where: { weekday: "WEDNESDAY" } }),
      tx.weekdayUniform.findUnique({ where: { weekday: "SUNDAY" } }),
      tx.team.findFirst({ where: { monthCycleId, teamType: "YOUTH" }, select: { id: true } }),
      tx.youthServiceUniform.findFirst(),
    ]);

    if (!weekdayWed) {
      warnings.push({
        code: "UNIFORME_MIERCOLES_NO_CONFIGURADO",
        message: "No hay un uniforme configurado para el miércoles; los turnos se generaron sin uniforme asignado.",
      });
    }
    if (!weekdaySun) {
      warnings.push({
        code: "UNIFORME_DOMINGO_NO_CONFIGURADO",
        message: "No hay un uniforme configurado para el domingo; los turnos se generaron sin uniforme asignado.",
      });
    }

    const slotsData = [];

    // 1. Miércoles: 17:00 y 19:00, un equipo cada uno.
    for (const civilDate of weekdaysIn(month.year, month.month, 3)) {
      const date = toDbDate(civilDate);
      for (const startTime of ["17:00", "19:00"]) {
        slotsData.push({
          monthCycleId,
          date,
          startTime,
          slotType: "FIXED",
          teamsNeeded: 1,
          countsTowardBalance: true,
          uniformId: weekdayWed?.uniformId ?? null,
        });
      }
    }

    // 2. Domingo: 08:00 y 10:30, salvo el último domingo (solo 08:00, 2 equipos).
    const lastSunday = lastSundayOf(month.year, month.month);
    for (const civilDate of weekdaysIn(month.year, month.month, 0)) {
      const date = toDbDate(civilDate);
      if (isSameCivilDate(civilDate, lastSunday)) {
        slotsData.push({
          monthCycleId,
          date,
          startTime: "08:00",
          slotType: "FIXED",
          teamsNeeded: 2,
          countsTowardBalance: true,
          uniformId: weekdaySun?.uniformId ?? null,
        });
      } else {
        for (const startTime of ["08:00", "10:30"]) {
          slotsData.push({
            monthCycleId,
            date,
            startTime,
            slotType: "FIXED",
            teamsNeeded: 1,
            countsTowardBalance: true,
            uniformId: weekdaySun?.uniformId ?? null,
          });
        }
      }
    }

    // 3. Servicio de jóvenes, solo si el mes tiene equipo YOUTH.
    if (youthTeam) {
      if (!youthUniformRow) {
        warnings.push({
          code: "UNIFORME_JOVENES_NO_CONFIGURADO",
          message: "No hay un uniforme configurado para el Servicio de jóvenes; el slot se generó sin uniforme asignado.",
        });
      }
      slotsData.push({
        monthCycleId,
        date: toDbDate(lastSaturdayOf(month.year, month.month)),
        startTime: "18:50",
        slotType: "YOUTH_SERVICE",
        title: "Servicio de jóvenes",
        teamsNeeded: 1,
        countsTowardBalance: true,
        uniformId: youthUniformRow?.uniformId ?? null,
      });
    }

    await tx.serviceSlot.createMany({ data: slotsData });

    // Balance inicial: deja el mes con equipos ya asignados, no solo slots vacíos.
    await recomputeBalance(tx, monthCycleId);

    const slots = await tx.serviceSlot.findMany({
      where: { monthCycleId },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: SLOT_SELECT,
    });

    return { slots: slots.map(serializeSlot), warnings };
  });
}

// ---------------------------------------------------------------------------
// GET /api/months/:id/schedule
// ---------------------------------------------------------------------------

export async function getMonthSchedule(monthCycleId) {
  const month = await prisma.monthCycle.findUnique({ where: { id: monthCycleId }, select: { id: true } });
  if (!month) throw new NotFoundError("Mes no encontrado.");

  const slots = await prisma.serviceSlot.findMany({
    where: { monthCycleId },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: SLOT_SELECT,
  });

  if (slots.length === 0) {
    // Horario todavía no generado: no es un error, respuesta vacía.
    return { slots: [], balance: [] };
  }

  const regularTeams = await prisma.team.findMany({
    where: { monthCycleId, teamType: "REGULAR" },
    orderBy: { orderIndex: "asc" },
    select: { id: true, label: true },
  });

  // Sin contador denormalizado (ver docs/architecture/phase1-schema-design.md
  // §5): el conteo es siempre COUNT(slot_assignment) filtrado por
  // serviceSlot.countsTowardBalance.
  const counts = await prisma.slotAssignment.groupBy({
    by: ["teamId"],
    where: { monthCycleId, serviceSlot: { countsTowardBalance: true } },
    _count: { _all: true },
  });
  const countByTeam = new Map(counts.map((c) => [c.teamId, c._count._all]));

  const balance = regularTeams.map((t) => ({
    teamId: t.id,
    label: t.label,
    count: countByTeam.get(t.id) ?? 0,
  }));

  return { slots: slots.map(serializeSlot), balance };
}
