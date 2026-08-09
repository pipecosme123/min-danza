// PATCH /api/slots/:id — asignar/limpiar el uniforme de UN ServiceSlot
// puntual, sea FIXED, YOUTH_SERVICE o EXTRAORDINARY. Contrato cerrado:
// docs/architecture/phase4b-schedule-refinements-contract.md §1.3, relajado
// tras publicar por docs/architecture/phase4c-post-publish-edits-contract.md
// §5 (permitido en mes FINALIZED actual/futuro, sigue bloqueado en uno ya
// pasado). El router (routes/slots.routes.js) solo parsea/valida/serializa;
// toda regla vive acá.

import { prisma } from "../lib/prisma.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import { SLOT_SELECT, serializeSlot } from "./scheduleGeneration.service.js";
import { assertEditableConsideringFinalization } from "../utils/monthLifecycle.js";
import { invalidateCached } from "../lib/cache.js";
import { cacheKeyFor } from "./publicSchedule.service.js";

/**
 * @param {string} slotId
 * @param {string | null} uniformId
 */
export async function updateSlotUniform(slotId, uniformId) {
  const slot = await prisma.serviceSlot.findUnique({
    where: { id: slotId },
    include: { monthCycle: { select: { year: true, month: true, status: true } } },
  });
  if (!slot) {
    throw new NotFoundError("Turno no encontrado.", { code: "TURNO_NO_ENCONTRADO" });
  }
  assertEditableConsideringFinalization(slot.monthCycle);

  if (uniformId !== null) {
    const uniform = await prisma.uniform.findUnique({ where: { id: uniformId }, select: { id: true, active: true } });
    if (!uniform || !uniform.active) {
      throw new ValidationError("El uniforme indicado no existe o no está activo.", { code: "UNIFORME_NO_VALIDO" });
    }
  }

  await prisma.serviceSlot.update({ where: { id: slotId }, data: { uniformId } });

  const updated = await prisma.serviceSlot.findUnique({ where: { id: slotId }, select: SLOT_SELECT });

  // Fase 4c: este endpoint ahora puede mutar un mes FINALIZED (actual/futuro),
  // que puede estar cacheado como página pública. Invalidar puntualmente esa
  // clave evita servir un uniforme desactualizado (CLAUDE.md, sección Caché).
  invalidateCached(cacheKeyFor(slot.monthCycle.year, slot.monthCycle.month));

  return { slot: serializeSlot(updated) };
}
