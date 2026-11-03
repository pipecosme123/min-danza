// PATCH /api/assignments/:id (lock/unlock, reasignar equipo a mano).
// Contrato cerrado: docs/architecture/phase4-schedule-contract.md §6,
// relajado tras publicar por
// docs/architecture/phase4c-post-publish-edits-contract.md §5 (permitido en
// mes FINALIZED actual/futuro, sigue bloqueado en uno ya pasado). El router
// (routes/assignments.routes.js) solo parsea/valida/serializa; toda regla
// vive acá.

import { prisma } from "../lib/prisma.js";
import { NotFoundError, ValidationError, ConflictError } from "../utils/errors.js";
import { assertEditableConsideringFinalization } from "../utils/monthLifecycle.js";
import { invalidateCached } from "../lib/cache.js";
import { cacheKeyFor } from "./publicSchedule.service.js";
import { hasAttendanceReport } from "./attendance.service.js";

const ASSIGNMENT_SELECT = {
  id: true,
  serviceSlotId: true,
  teamId: true,
  slotIndex: true,
  locked: true,
};

/**
 * @param {string} assignmentId
 * @param {{ locked?: boolean, teamId?: string }} data
 */
export async function updateAssignment(assignmentId, data) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.slotAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        serviceSlot: {
          select: {
            slotType: true,
            monthCycleId: true,
            monthCycle: { select: { year: true, month: true, status: true } },
          },
        },
      },
    });
    if (!assignment) {
      throw new NotFoundError("Asignación no encontrada.", { code: "ASIGNACION_NO_ENCONTRADA" });
    }
    assertEditableConsideringFinalization(assignment.serviceSlot.monthCycle);

    const wantsTeamChange = data.teamId !== undefined;

    if (wantsTeamChange && assignment.serviceSlot.slotType === "YOUTH_SERVICE") {
      throw new ValidationError(
        "El equipo del Servicio de jóvenes no se puede reasignar a mano: siempre es el equipo YOUTH del mes.",
        { code: "ASIGNACION_JOVENES_NO_EDITABLE" }
      );
    }

    // Fase 9 (ampliado 2026-09-13): el reporte de asistencia es del TURNO,
    // no de un equipo puntual (un turno con 2+ equipos comparte un único
    // reporte entre sus líderes) -- reasignar cualquiera de los equipos de
    // un turno que ya tiene reporte dejaría su padrón corrupto (le sobraría
    // o faltaría gente). El admin debe reabrir o eliminar el reporte primero.
    if (wantsTeamChange && (await hasAttendanceReport(assignment.serviceSlotId))) {
      throw new ConflictError(
        "Este turno ya tiene un reporte de asistencia; no se puede reasignar.",
        { code: "ASIGNACION_CON_REPORTE" }
      );
    }

    const updateData = {};

    if (wantsTeamChange) {
      const team = await tx.team.findUnique({
        where: { id: data.teamId },
        select: { id: true, monthCycleId: true, teamType: true },
      });
      if (!team || team.monthCycleId !== assignment.serviceSlot.monthCycleId || team.teamType !== "REGULAR") {
        throw new ValidationError("El equipo indicado no es válido para esta asignación.", { code: "EQUIPO_NO_VALIDO" });
      }
      updateData.teamId = data.teamId;
      // Reasignar a mano siempre fija la asignación: si no se fijara,
      // recomputeBalance podría deshacer la reasignación en la próxima
      // corrida, lo cual no tendría sentido para una edición manual.
      updateData.locked = true;
    } else if (typeof data.locked === "boolean") {
      updateData.locked = data.locked;
    }

    const updated = await tx.slotAssignment.update({
      where: { id: assignmentId },
      data: updateData,
      select: ASSIGNMENT_SELECT,
    });

    // Fase 4c: este endpoint ahora puede mutar un mes FINALIZED
    // (actual/futuro), que puede estar cacheado como página pública. Sin
    // invalidar puntualmente esta clave, la reasignación/lock de un turno no
    // se reflejaría en la vista pública hasta que expire el TTL de defensa
    // en profundidad (ver publicSchedule.service.js).
    const { year, month } = assignment.serviceSlot.monthCycle;
    invalidateCached(cacheKeyFor(year, month));

    return { assignment: updated };
  });
}
