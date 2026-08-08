// PATCH /api/assignments/:id (lock/unlock, reasignar equipo a mano).
// Contrato cerrado: docs/architecture/phase4-schedule-contract.md §6. El
// router (routes/assignments.routes.js) solo parsea/valida/serializa; toda
// regla vive acá.

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";

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
        serviceSlot: { select: { slotType: true, monthCycleId: true, monthCycle: { select: { status: true } } } },
      },
    });
    if (!assignment) {
      throw new NotFoundError("Asignación no encontrada.", { code: "ASIGNACION_NO_ENCONTRADA" });
    }
    if (assignment.serviceSlot.monthCycle.status !== "DRAFT") {
      throw new ConflictError("El mes ya está finalizado y no admite cambios.", { code: "MES_FINALIZADO" });
    }

    const wantsTeamChange = data.teamId !== undefined;

    if (wantsTeamChange && assignment.serviceSlot.slotType === "YOUTH_SERVICE") {
      throw new ValidationError(
        "El equipo del Servicio de jóvenes no se puede reasignar a mano: siempre es el equipo YOUTH del mes.",
        { code: "ASIGNACION_JOVENES_NO_EDITABLE" }
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

    return { assignment: updated };
  });
}
