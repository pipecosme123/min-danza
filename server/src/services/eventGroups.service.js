// Eventos agrupados ("Congreso" es el ejemplo, no un tipo especial
// hardcodeado -- cualquier título): 2+ fechas, cada fecha con 1+ turnos, cada
// turno con hora + uno o más equipos elegidos A MANO por el admin (no
// auto-balanceados) + uniforme opcional. Parte 2, wise-noodling-hickey.md.
//
// Diferencia clave con un evento extraordinario suelto (events.service.js):
// los equipos de un turno de Congreso los elige el admin a mano, se crean
// como SlotAssignment con locked: true DIRECTO, sin pasar por
// recomputeBalance. Igual cuentan al balance porque cada turno es un
// ServiceSlot normal (slotType: EXTRAORDINARY, countsTowardBalance: true) --
// el conteo de GET /schedule ya es un groupBy sobre SlotAssignment filtrado
// por eso, no le importa de dónde vino la asignación.
//
// El router (routes/eventGroups.routes.js) solo parsea/valida/serializa;
// toda regla vive acá.

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { SLOT_SELECT, serializeSlot } from "./scheduleGeneration.service.js";
import { assertEditableConsideringFinalization } from "../utils/monthLifecycle.js";
import { invalidateCached } from "../lib/cache.js";
import { cacheKeyFor } from "./publicSchedule.service.js";

function invalidatePublicCache(year, month) {
  invalidateCached(cacheKeyFor(year, month));
}

function assertDateWithinMonth(date, month) {
  const [year, monthNum] = date.split("-").map(Number);
  if (year !== month.year || monthNum !== month.month) {
    throw new ValidationError("La fecha del turno debe caer dentro del mes/año de este ciclo.", {
      code: "FECHA_FUERA_DE_MES",
    });
  }
}

/** Mismo código EQUIPO_NO_VALIDO que ya usa assignments.service.js#updateAssignment. */
async function assertValidTurnoTeams(tx, monthCycleId, teamIds) {
  if (!Array.isArray(teamIds) || teamIds.length === 0) {
    throw new ValidationError("Cada turno necesita al menos un equipo.", { code: "EQUIPO_NO_VALIDO" });
  }
  const uniqueIds = new Set(teamIds);
  if (uniqueIds.size !== teamIds.length) {
    throw new ValidationError("No se puede repetir el mismo equipo dentro de un turno.", { code: "EQUIPO_NO_VALIDO" });
  }
  const teams = await tx.team.findMany({
    where: { id: { in: teamIds }, monthCycleId, teamType: "REGULAR" },
    select: { id: true },
  });
  if (teams.length !== teamIds.length) {
    throw new ValidationError("Uno o más equipos indicados no son válidos para este mes.", { code: "EQUIPO_NO_VALIDO" });
  }
}

async function assertValidUniform(tx, uniformId) {
  if (!uniformId) return;
  const uniform = await tx.uniform.findUnique({ where: { id: uniformId }, select: { id: true, active: true } });
  if (!uniform || !uniform.active) {
    throw new ValidationError("El uniforme indicado no existe o no está activo.", { code: "UNIFORME_NO_VALIDO" });
  }
}

function serializeGroup(group) {
  return {
    id: group.id,
    title: group.title,
    slots: group.slots.map(serializeSlot),
  };
}

async function loadGroupOrThrow(tx, groupId) {
  const group = await tx.eventGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      title: true,
      monthCycleId: true,
      monthCycle: { select: { id: true, year: true, month: true, status: true } },
      slots: { orderBy: [{ date: "asc" }, { startTime: "asc" }], select: SLOT_SELECT },
    },
  });
  if (!group) {
    throw new NotFoundError("Evento agrupado no encontrado.", { code: "EVENTO_AGRUPADO_NO_ENCONTRADO" });
  }
  return group;
}

// Crea el ServiceSlot + sus SlotAssignment (locked: true) de un turno dentro
// de una transacción ya abierta. No valida nada -- el caller ya validó fecha/
// equipos/uniforme antes de llamar esto.
async function createTurnoSlot(tx, { monthCycleId, groupId, title, date, startTime, teamIds, uniformId }) {
  const slot = await tx.serviceSlot.create({
    data: {
      monthCycleId,
      date: new Date(date),
      startTime,
      slotType: "EXTRAORDINARY",
      title,
      teamsNeeded: teamIds.length,
      countsTowardBalance: true,
      uniformId: uniformId ?? null,
      eventGroupId: groupId,
    },
  });
  await tx.slotAssignment.createMany({
    data: teamIds.map((teamId, index) => ({
      serviceSlotId: slot.id,
      teamId,
      monthCycleId,
      slotIndex: index,
      locked: true,
    })),
  });
  return slot;
}

/**
 * @param {string} monthCycleId
 * @param {{ title: string, turnos: { date: string, startTime: string, teamIds: string[], uniformId?: string }[] }} data
 */
export async function createEventGroup(monthCycleId, data) {
  return prisma.$transaction(async (tx) => {
    const month = await tx.monthCycle.findUnique({ where: { id: monthCycleId } });
    if (!month) throw new NotFoundError("Mes no encontrado.");
    assertEditableConsideringFinalization(month);

    const existingSlotCount = await tx.serviceSlot.count({ where: { monthCycleId } });
    if (existingSlotCount === 0) {
      throw new ConflictError(
        "Todavía no se generó el horario base de este mes; generalo antes de agregar un evento agrupado.",
        { code: "HORARIO_NO_GENERADO" }
      );
    }

    for (const turno of data.turnos) {
      assertDateWithinMonth(turno.date, month);
    }

    const distinctDates = new Set(data.turnos.map((t) => t.date));
    if (distinctDates.size < 2) {
      throw new ValidationError("Un evento agrupado necesita al menos 2 fechas distintas.", {
        code: "CONGRESO_MINIMO_DOS_FECHAS",
      });
    }

    for (const turno of data.turnos) {
      await assertValidTurnoTeams(tx, monthCycleId, turno.teamIds);
      await assertValidUniform(tx, turno.uniformId);
    }

    const group = await tx.eventGroup.create({ data: { monthCycleId, title: data.title } });

    for (const turno of data.turnos) {
      await createTurnoSlot(tx, {
        monthCycleId,
        groupId: group.id,
        title: data.title,
        date: turno.date,
        startTime: turno.startTime,
        teamIds: turno.teamIds,
        uniformId: turno.uniformId,
      });
    }

    invalidatePublicCache(month.year, month.month);

    const created = await loadGroupOrThrow(tx, group.id);
    return { group: serializeGroup(created) };
  });
}

/** @param {string} monthCycleId */
export async function listEventGroups(monthCycleId) {
  const month = await prisma.monthCycle.findUnique({ where: { id: monthCycleId }, select: { id: true } });
  if (!month) throw new NotFoundError("Mes no encontrado.");

  const groups = await prisma.eventGroup.findMany({
    where: { monthCycleId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      slots: { orderBy: [{ date: "asc" }, { startTime: "asc" }], select: SLOT_SELECT },
    },
  });

  return { groups: groups.map(serializeGroup) };
}

/**
 * Renombra el grupo Y sus slots -- title está denormalizado en ServiceSlot
 * para no forzar un JOIN en cada lectura de horario.
 * @param {string} groupId
 * @param {string} title
 */
export async function updateEventGroupTitle(groupId, title) {
  return prisma.$transaction(async (tx) => {
    const group = await loadGroupOrThrow(tx, groupId);
    assertEditableConsideringFinalization(group.monthCycle);

    await tx.eventGroup.update({ where: { id: groupId }, data: { title } });
    await tx.serviceSlot.updateMany({ where: { eventGroupId: groupId }, data: { title } });

    invalidatePublicCache(group.monthCycle.year, group.monthCycle.month);

    const updated = await loadGroupOrThrow(tx, groupId);
    return { group: serializeGroup(updated) };
  });
}

/**
 * Agrega un turno más a un grupo existente. Mismas validaciones que un turno
 * de createEventGroup, pero sin exigir el mínimo de 2 fechas (ese mínimo solo
 * aplica al crear el grupo).
 * @param {string} groupId
 * @param {{ date: string, startTime: string, teamIds: string[], uniformId?: string }} data
 */
export async function addTurno(groupId, data) {
  return prisma.$transaction(async (tx) => {
    const group = await loadGroupOrThrow(tx, groupId);
    assertEditableConsideringFinalization(group.monthCycle);

    assertDateWithinMonth(data.date, group.monthCycle);
    await assertValidTurnoTeams(tx, group.monthCycleId, data.teamIds);
    await assertValidUniform(tx, data.uniformId);

    const slot = await createTurnoSlot(tx, {
      monthCycleId: group.monthCycleId,
      groupId,
      title: group.title,
      date: data.date,
      startTime: data.startTime,
      teamIds: data.teamIds,
      uniformId: data.uniformId,
    });

    invalidatePublicCache(group.monthCycle.year, group.monthCycle.month);

    const created = await tx.serviceSlot.findUnique({ where: { id: slot.id }, select: SLOT_SELECT });
    return { slot: serializeSlot(created) };
  });
}

/**
 * Edita un turno puntual de un grupo. Si viene teamIds, reemplaza el set
 * completo de SlotAssignment de ese slot (borra todas, recrea locked: true
 * para cada id nuevo, actualiza teamsNeeded) -- mismo patrón "reemplaza el
 * roster completo" que updateTeam (teamGeneration.service.js).
 * @param {string} slotId
 * @param {{ date?: string, startTime?: string, teamIds?: string[], uniformId?: string | null }} data
 */
export async function updateTurno(slotId, data) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.serviceSlot.findUnique({
      where: { id: slotId },
      include: { monthCycle: { select: { id: true, year: true, month: true, status: true } } },
    });
    if (!slot || !slot.eventGroupId) {
      throw new NotFoundError("Turno de evento agrupado no encontrado.", { code: "TURNO_NO_ENCONTRADO" });
    }
    assertEditableConsideringFinalization(slot.monthCycle);

    if (data.date !== undefined) assertDateWithinMonth(data.date, slot.monthCycle);
    if (data.uniformId !== undefined && data.uniformId !== null) await assertValidUniform(tx, data.uniformId);
    if (data.teamIds !== undefined) await assertValidTurnoTeams(tx, slot.monthCycleId, data.teamIds);

    const updateData = {};
    if (data.date !== undefined) updateData.date = new Date(data.date);
    if (data.startTime !== undefined) updateData.startTime = data.startTime;
    if (data.uniformId !== undefined) updateData.uniformId = data.uniformId;
    if (data.teamIds !== undefined) updateData.teamsNeeded = data.teamIds.length;

    await tx.serviceSlot.update({ where: { id: slotId }, data: updateData });

    if (data.teamIds !== undefined) {
      await tx.slotAssignment.deleteMany({ where: { serviceSlotId: slotId } });
      await tx.slotAssignment.createMany({
        data: data.teamIds.map((teamId, index) => ({
          serviceSlotId: slotId,
          teamId,
          monthCycleId: slot.monthCycleId,
          slotIndex: index,
          locked: true,
        })),
      });
    }

    invalidatePublicCache(slot.monthCycle.year, slot.monthCycle.month);

    const updated = await tx.serviceSlot.findUnique({ where: { id: slotId }, select: SLOT_SELECT });
    return { slot: serializeSlot(updated) };
  });
}

/**
 * Borra un turno suelto del grupo (cascada borra sus SlotAssignment). Si era
 * el último turno del grupo, borra también el EventGroup ya vacío -- no
 * dejar grupos huérfanos sin turnos. Sin mínimo de 2 turnos después de
 * creado -- el mínimo de 2 fechas solo aplica al crear.
 * @param {string} slotId
 */
export async function deleteTurno(slotId) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.serviceSlot.findUnique({
      where: { id: slotId },
      include: { monthCycle: { select: { id: true, year: true, month: true, status: true } } },
    });
    if (!slot || !slot.eventGroupId) {
      throw new NotFoundError("Turno de evento agrupado no encontrado.", { code: "TURNO_NO_ENCONTRADO" });
    }
    assertEditableConsideringFinalization(slot.monthCycle);

    const groupId = slot.eventGroupId;
    await tx.serviceSlot.delete({ where: { id: slotId } });

    const remaining = await tx.serviceSlot.count({ where: { eventGroupId: groupId } });
    let groupDeleted = false;
    if (remaining === 0) {
      await tx.eventGroup.delete({ where: { id: groupId } });
      groupDeleted = true;
    }

    invalidatePublicCache(slot.monthCycle.year, slot.monthCycle.month);
    return { deleted: true, groupDeleted };
  });
}

/**
 * Cancela TODOS los turnos activos del grupo a la vez (mismo mecanismo
 * cancelledAt/countsTowardBalance: false + limpiar SlotAssignment que ya usa
 * events.service.js#cancelEvent, aplicado turno por turno dentro de una
 * transacción).
 * @param {string} groupId
 */
export async function cancelEventGroup(groupId) {
  return prisma.$transaction(async (tx) => {
    const group = await loadGroupOrThrow(tx, groupId);
    assertEditableConsideringFinalization(group.monthCycle);

    const activeSlotIds = group.slots.filter((s) => s.cancelledAt === null).map((s) => s.id);
    if (activeSlotIds.length === 0) {
      throw new ConflictError("Este evento agrupado ya está cancelado.", { code: "CONGRESO_YA_CANCELADO" });
    }

    await tx.serviceSlot.updateMany({
      where: { id: { in: activeSlotIds } },
      data: { cancelledAt: new Date(), countsTowardBalance: false },
    });
    // Cancelar prevalece sobre locked, mismo criterio que cancelEvent.
    await tx.slotAssignment.deleteMany({ where: { serviceSlotId: { in: activeSlotIds } } });

    invalidatePublicCache(group.monthCycle.year, group.monthCycle.month);

    const updated = await loadGroupOrThrow(tx, groupId);
    return { group: serializeGroup(updated) };
  });
}

/**
 * Borra el EventGroup completo (cascada borra todos sus ServiceSlot y
 * SlotAssignment).
 * @param {string} groupId
 */
export async function deleteEventGroup(groupId) {
  return prisma.$transaction(async (tx) => {
    const group = await loadGroupOrThrow(tx, groupId);
    assertEditableConsideringFinalization(group.monthCycle);

    await tx.eventGroup.delete({ where: { id: groupId } });

    invalidatePublicCache(group.monthCycle.year, group.monthCycle.month);
    return { deleted: true };
  });
}
