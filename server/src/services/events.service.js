// Eventos extraordinarios (ServiceSlot slotType EXTRAORDINARY). Contrato
// cerrado: docs/architecture/phase4-schedule-contract.md §4-5, ampliado por
// docs/architecture/phase4b-schedule-refinements-contract.md §5.1
// (PATCH para editar en vez de eliminar+recrear) y por
// docs/architecture/phase4c-post-publish-edits-contract.md §4 (agregar/
// cancelar/eliminar siguen permitidos tras publicar, si el mes es actual o
// futuro). El router (routes/events.routes.js) solo parsea/valida/
// serializa; toda regla vive acá.

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { SLOT_SELECT, serializeSlot } from "./scheduleGeneration.service.js";
import { recomputeBalance } from "./balance.service.js";
import { assertEditableConsideringFinalization } from "../utils/monthLifecycle.js";
import { invalidateCached } from "../lib/cache.js";
import { cacheKeyFor } from "./publicSchedule.service.js";

// Fase 4c: antes de esta fase, ninguna de estas escrituras podía tocar un
// mes FINALIZED (todas exigían DRAFT), así que el mes ya publicado -y por lo
// tanto ya cacheado bajo `schedule:${year}:${month}` en publicSchedule
// service- nunca podía quedar desactualizado. Ahora que agregar/cancelar/
// eliminar SÍ pueden mutar un mes FINALIZED actual/futuro, hay que invalidar
// explícitamente esa clave puntual (CLAUDE.md, sección Caché: "nunca dejes
// un caché sirviendo datos obsoletos tras un cambio administrativo"). No
// hace falta condicionar a "estaba FINALIZED": invalidar una clave que nunca
// se cacheó (mes todavía DRAFT) es una operación barata sin efecto.
function invalidatePublicCache(year, month) {
  invalidateCached(cacheKeyFor(year, month));
}

/**
 * @param {string} monthCycleId
 * @param {{ date: string, startTime: string, title: string, teamsNeeded: number, uniformId?: string }} data
 */
export async function createEvent(monthCycleId, data) {
  return prisma.$transaction(async (tx) => {
    const month = await tx.monthCycle.findUnique({ where: { id: monthCycleId } });
    if (!month) throw new NotFoundError("Mes no encontrado.");
    assertEditableConsideringFinalization(month);

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

    // Mes DRAFT: recompute completo, sin cambios respecto al comportamiento
    // histórico. Mes FINALIZED (ya validado actual/futuro arriba): modo
    // acotado, decide equipo(s) SOLO para el evento nuevo, sin reordenar
    // nada de lo ya publicado (contrato Fase 4c §4).
    if (month.status === "DRAFT") {
      await recomputeBalance(tx, monthCycleId);
    } else {
      await recomputeBalance(tx, monthCycleId, { onlySlotIds: [created.id] });
    }

    const slot = await tx.serviceSlot.findUnique({ where: { id: created.id }, select: SLOT_SELECT });
    invalidatePublicCache(month.year, month.month);
    return { slot: serializeSlot(slot) };
  });
}

/**
 * Edita un evento extraordinario existente sin borrarlo/recrearlo (mismo id
 * antes y después). Contrato: phase4b-schedule-refinements-contract.md §5.1.
 * @param {string} eventId
 * @param {{ date?: string, startTime?: string, title?: string, teamsNeeded?: number, uniformId?: string | null }} data
 */
export async function updateEvent(eventId, data) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.serviceSlot.findUnique({
      where: { id: eventId },
      include: { monthCycle: { select: { id: true, year: true, month: true, status: true } } },
    });

    if (!slot || slot.slotType !== "EXTRAORDINARY") {
      throw new NotFoundError("Evento no encontrado.", { code: "EVENTO_NO_ENCONTRADO" });
    }
    if (slot.monthCycle.status !== "DRAFT") {
      throw new ConflictError("El mes ya está finalizado y no admite cambios.", { code: "MES_FINALIZADO" });
    }

    if (data.date !== undefined) {
      const [year, monthNum] = data.date.split("-").map(Number);
      if (year !== slot.monthCycle.year || monthNum !== slot.monthCycle.month) {
        throw new ValidationError("La fecha del evento debe caer dentro del mes/año de este ciclo.", {
          code: "FECHA_FUERA_DE_MES",
        });
      }
    }

    if (data.uniformId !== undefined && data.uniformId !== null) {
      const uniform = await tx.uniform.findUnique({ where: { id: data.uniformId }, select: { id: true, active: true } });
      if (!uniform || !uniform.active) {
        throw new ValidationError("El uniforme indicado no existe o no está activo.", { code: "UNIFORME_NO_VALIDO" });
      }
    }

    if (data.teamsNeeded !== undefined) {
      const lockedCount = await tx.slotAssignment.count({ where: { serviceSlotId: eventId, locked: true } });
      if (data.teamsNeeded < lockedCount) {
        throw new ConflictError(
          "No se puede reducir la cantidad de equipos por debajo de las asignaciones ya bloqueadas. Desbloqueá primero.",
          { code: "EQUIPOS_BLOQUEADOS_EXCEDEN_CUPO", locked: lockedCount, teamsNeeded: data.teamsNeeded }
        );
      }
    }

    const updateData = {};
    if (data.date !== undefined) updateData.date = new Date(data.date);
    if (data.startTime !== undefined) updateData.startTime = data.startTime;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.teamsNeeded !== undefined) updateData.teamsNeeded = data.teamsNeeded;
    if (data.uniformId !== undefined) updateData.uniformId = data.uniformId;

    await tx.serviceSlot.update({ where: { id: eventId }, data: updateData });

    await recomputeBalance(tx, slot.monthCycleId);

    const updated = await tx.serviceSlot.findUnique({ where: { id: eventId }, select: SLOT_SELECT });
    return { slot: serializeSlot(updated) };
  });
}

/**
 * @param {string} eventId
 */
export async function deleteEvent(eventId) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.serviceSlot.findUnique({
      where: { id: eventId },
      include: { monthCycle: { select: { id: true, year: true, month: true, status: true } } },
    });

    if (!slot || slot.slotType !== "EXTRAORDINARY") {
      throw new NotFoundError("Evento no encontrado.", { code: "EVENTO_NO_ENCONTRADO" });
    }
    assertEditableConsideringFinalization(slot.monthCycle);

    const wasDraft = slot.monthCycle.status === "DRAFT";

    await tx.serviceSlot.delete({ where: { id: eventId } });

    // Mes DRAFT: recompute completo, sin cambios respecto al comportamiento
    // histórico. Mes FINALIZED (ya validado actual/futuro arriba): nada más
    // necesita reacomodarse, no se llama recomputeBalance (contrato Fase 4c §4).
    if (wasDraft) {
      await recomputeBalance(tx, slot.monthCycleId);
    }

    invalidatePublicCache(slot.monthCycle.year, slot.monthCycle.month);
    return { deleted: true };
  });
}

/**
 * Cancela (no elimina) un evento extraordinario: queda registrado y visible,
 * marcado como cancelado, deja de necesitar equipo. Contrato Fase 4c §4.
 * @param {string} eventId
 */
export async function cancelEvent(eventId) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.serviceSlot.findUnique({
      where: { id: eventId },
      include: { monthCycle: { select: { id: true, year: true, month: true, status: true } } },
    });

    if (!slot || slot.slotType !== "EXTRAORDINARY") {
      throw new NotFoundError("Evento no encontrado.", { code: "EVENTO_NO_ENCONTRADO" });
    }
    assertEditableConsideringFinalization(slot.monthCycle);

    if (slot.cancelledAt !== null) {
      throw new ConflictError("Este evento ya está cancelado.", { code: "EVENTO_YA_CANCELADO" });
    }

    await tx.serviceSlot.update({
      where: { id: eventId },
      data: { cancelledAt: new Date(), countsTowardBalance: false },
    });
    // Cancelar es una decisión explícita del admin que prevalece sobre
    // `locked`: se borran todas las SlotAssignment del evento, fijadas o no.
    await tx.slotAssignment.deleteMany({ where: { serviceSlotId: eventId } });

    // Nada se reacomoda: no se llama recomputeBalance.

    const updated = await tx.serviceSlot.findUnique({ where: { id: eventId }, select: SLOT_SELECT });
    invalidatePublicCache(slot.monthCycle.year, slot.monthCycle.month);
    return { slot: serializeSlot(updated) };
  });
}
