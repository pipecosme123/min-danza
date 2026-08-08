// PATCH /api/slots/:id — asignar/limpiar el uniforme de UN ServiceSlot
// puntual, sea FIXED, YOUTH_SERVICE o EXTRAORDINARY. Contrato cerrado:
// docs/architecture/phase4b-schedule-refinements-contract.md §1.3. El router
// (routes/slots.routes.js) solo parsea/valida/serializa; toda regla vive
// acá.

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { SLOT_SELECT, serializeSlot } from "./scheduleGeneration.service.js";

/**
 * @param {string} slotId
 * @param {string | null} uniformId
 */
export async function updateSlotUniform(slotId, uniformId) {
  const slot = await prisma.serviceSlot.findUnique({
    where: { id: slotId },
    include: { monthCycle: { select: { status: true } } },
  });
  if (!slot) {
    throw new NotFoundError("Turno no encontrado.", { code: "TURNO_NO_ENCONTRADO" });
  }
  if (slot.monthCycle.status !== "DRAFT") {
    throw new ConflictError("El mes ya está finalizado y no admite cambios.", { code: "MES_FINALIZADO" });
  }

  if (uniformId !== null) {
    const uniform = await prisma.uniform.findUnique({ where: { id: uniformId }, select: { id: true, active: true } });
    if (!uniform || !uniform.active) {
      throw new ValidationError("El uniforme indicado no existe o no está activo.", { code: "UNIFORME_NO_VALIDO" });
    }
  }

  await prisma.serviceSlot.update({ where: { id: slotId }, data: { uniformId } });

  const updated = await prisma.serviceSlot.findUnique({ where: { id: slotId }, select: SLOT_SELECT });
  return { slot: serializeSlot(updated) };
}
