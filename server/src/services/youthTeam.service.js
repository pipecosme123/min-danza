// Cancelar/eliminar el Servicio de jóvenes sin tener que re-sortear TODO el
// mes (antes la única forma de quitarlo era volver a correr
// POST /generate-teams sin youthTeam.enabled). Mismo patrón que
// cancelEvent/deleteEvent en events.service.js, pero en un archivo aparte:
// publicSchedule.service.js ya importa TEAM_SELECT/serializeTeam desde
// teamGeneration.service.js, así que si teamGeneration.service.js importara
// cacheKeyFor desde publicSchedule.service.js (como hacen events.service.js/
// slots.service.js) se cerraría un ciclo de imports ESM. Este archivo nuevo,
// sin que nadie lo importe de vuelta, lo evita limpio. El router
// (routes/teams.routes.js) solo parsea/valida/serializa; toda regla vive acá.

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { SLOT_SELECT, serializeSlot } from "./scheduleGeneration.service.js";
import { assertEditableConsideringFinalization } from "../utils/monthLifecycle.js";
import { invalidateCached } from "../lib/cache.js";
import { cacheKeyFor } from "./publicSchedule.service.js";

/**
 * Cancela (no elimina) el turno YOUTH_SERVICE del mes: queda registrado y
 * visible, marcado como cancelado, deja de necesitar equipo y de contar al
 * balance -- pero el Team YOUTH y sus integrantes se conservan intactos
 * (a diferencia de deleteYouthTeam). Mismo mecanismo que cancelEvent.
 * @param {string} monthCycleId
 */
export async function cancelYouthService(monthCycleId) {
  return prisma.$transaction(async (tx) => {
    const month = await tx.monthCycle.findUnique({ where: { id: monthCycleId } });
    if (!month) throw new NotFoundError("Mes no encontrado.");
    assertEditableConsideringFinalization(month);

    const slot = await tx.serviceSlot.findFirst({
      where: { monthCycleId, slotType: "YOUTH_SERVICE" },
    });
    if (!slot) {
      throw new NotFoundError("Este mes no tiene un turno de Servicio de jóvenes generado.", {
        code: "SERVICIO_JOVENES_NO_ENCONTRADO",
      });
    }
    if (slot.cancelledAt !== null) {
      throw new ConflictError("El Servicio de jóvenes ya está cancelado.", {
        code: "SERVICIO_JOVENES_YA_CANCELADO",
      });
    }

    await tx.serviceSlot.update({
      where: { id: slot.id },
      data: { cancelledAt: new Date(), countsTowardBalance: false },
    });
    // Cancelar prevalece sobre locked, mismo criterio que cancelEvent.
    await tx.slotAssignment.deleteMany({ where: { serviceSlotId: slot.id } });

    const updated = await tx.serviceSlot.findUnique({ where: { id: slot.id }, select: SLOT_SELECT });
    invalidateCached(cacheKeyFor(month.year, month.month));
    return { slot: serializeSlot(updated) };
  });
}

/**
 * Elimina por completo el equipo YOUTH del mes -- el Team, su
 * ServiceSlot YOUTH_SERVICE y todo lo que cuelgue de ambos (TeamMember,
 * SlotAssignment) cae en cascada a nivel de base de datos.
 * @param {string} monthCycleId
 */
export async function deleteYouthTeam(monthCycleId) {
  return prisma.$transaction(async (tx) => {
    const month = await tx.monthCycle.findUnique({ where: { id: monthCycleId } });
    if (!month) throw new NotFoundError("Mes no encontrado.");
    assertEditableConsideringFinalization(month);

    const team = await tx.team.findFirst({
      where: { monthCycleId, teamType: "YOUTH" },
      select: { id: true },
    });
    if (!team) {
      throw new NotFoundError("Este mes no tiene un equipo de jóvenes.", {
        code: "EQUIPO_JOVENES_NO_ENCONTRADO",
      });
    }

    // Borrado explícito del ServiceSlot primero (cascada se encarga de sus
    // SlotAssignment restantes); el team.delete de abajo cae en cascada
    // sobre TeamMember y cualquier SlotAssignment que quedara del equipo.
    await tx.serviceSlot.deleteMany({ where: { monthCycleId, slotType: "YOUTH_SERVICE" } });
    await tx.team.delete({ where: { id: team.id } });

    // youthTeamEnabled/youthTeamSize NO son fuente de verdad del sorteo ya
    // corrido (ver su doc en MONTH_SELECT, teamGeneration.service.js) --
    // solo gobiernan el default que la UI precarga en el próximo "Sortear
    // equipos". Escribirlos acá, fuera de generateTeams, es seguro.
    await tx.monthCycle.update({ where: { id: monthCycleId }, data: { youthTeamEnabled: false } });

    invalidateCached(cacheKeyFor(month.year, month.month));
    return { deleted: true };
  });
}
