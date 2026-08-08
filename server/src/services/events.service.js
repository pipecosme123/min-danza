// Eventos extraordinarios (ServiceSlot slotType EXTRAORDINARY). Contrato
// cerrado: docs/architecture/phase4-schedule-contract.md §4-5. El router
// (routes/events.routes.js) solo parsea/valida/serializa; toda regla vive
// acá.

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { SLOT_SELECT, serializeSlot } from "./scheduleGeneration.service.js";
import { recomputeBalance } from "./balance.service.js";

function assertDraft(month) {
  if (month.status !== "DRAFT") {
    throw new ConflictError("El mes ya está finalizado y no admite cambios.", { code: "MES_FINALIZADO" });
  }
}

/**
 * @param {string} monthCycleId
 * @param {{ date: string, startTime: string, title: string, teamsNeeded: number, uniformId?: string }} data
 */
export async function createEvent(monthCycleId, data) {
  return prisma.$transaction(async (tx) => {
    const month = await tx.monthCycle.findUnique({ where: { id: monthCycleId } });
    if (!month) throw new NotFoundError("Mes no encontrado.");
    assertDraft(month);

    const [year, monthNum] = data.date.split("-").map(Number);
    if (year !== month.year || monthNum !== month.month) {
      throw new ValidationError("La fecha del evento debe caer dentro del mes/año de este ciclo.", {
        code: "FECHA_FUERA_DE_MES",
      });
    }

    const existingSlotCount = await tx.serviceSlot.count({ where: { monthCycleId } });
    if (existingSlotCount === 0) {
      throw new ConflictError(
        "Todavía no se generó el horario base de este mes; generalo antes de agregar eventos extraordinarios.",
        { code: "HORARIO_NO_GENERADO" }
      );
    }

    if (data.uniformId) {
      const uniform = await tx.uniform.findUnique({ where: { id: data.uniformId }, select: { id: true, active: true } });
      if (!uniform || !uniform.active) {
        throw new ValidationError("El uniforme indicado no existe o no está activo.", { code: "UNIFORME_NO_VALIDO" });
      }
    }

    const created = await tx.serviceSlot.create({
      data: {
        monthCycleId,
        date: new Date(data.date),
        startTime: data.startTime,
        slotType: "EXTRAORDINARY",
        title: data.title,
        teamsNeeded: data.teamsNeeded,
        countsTowardBalance: true,
        uniformId: data.uniformId ?? null,
      },
    });

    await recomputeBalance(tx, monthCycleId);

    const slot = await tx.serviceSlot.findUnique({ where: { id: created.id }, select: SLOT_SELECT });
    return { slot: serializeSlot(slot) };
  });
}

/**
 * @param {string} eventId
 */
export async function deleteEvent(eventId) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.serviceSlot.findUnique({
      where: { id: eventId },
      include: { monthCycle: { select: { id: true, status: true } } },
    });

    if (!slot || slot.slotType !== "EXTRAORDINARY") {
      throw new NotFoundError("Evento no encontrado.", { code: "EVENTO_NO_ENCONTRADO" });
    }
    if (slot.monthCycle.status !== "DRAFT") {
      throw new ConflictError("El mes ya está finalizado y no admite cambios.", { code: "MES_FINALIZADO" });
    }

    await tx.serviceSlot.delete({ where: { id: eventId } });
    await recomputeBalance(tx, slot.monthCycleId);

    return { deleted: true };
  });
}
