// recomputeBalance: reparte equipos REGULAR entre los ServiceSlot que cuentan
// al balance del mes, respetando las asignaciones `locked`. Contrato cerrado
// en docs/architecture/phase1-schema-design.md §5,
// docs/architecture/phase4-schedule-contract.md §3, y refinado por
// docs/architecture/phase4b-schedule-refinements-contract.md §2 (preferir no
// repetir equipo en la misma semana ISO ANTES que el menor conteo
// acumulado) — no reinventar el algoritmo acá.
//
// Deliberadamente NO abre su propia transacción: recibe el cliente `tx` de
// una transacción ya en curso (scheduleGeneration.service.js, events al
// crear/borrar) para poder componerse sin anidar transacciones de Prisma.

import { pickRandom } from "../utils/shuffle.js";
import { mondayOfWeek, dbDateToCivilDate } from "../utils/dates.js";

function weekKey({ year, month, day }) {
  return `${year}-${month}-${day}`;
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} monthCycleId
 */
export async function recomputeBalance(tx, monthCycleId) {
  // 1. Borra las asignaciones no fijadas del mes. Las `locked: true` nunca se tocan.
  await tx.slotAssignment.deleteMany({ where: { monthCycleId, locked: false } });

  const teams = await tx.team.findMany({
    where: { monthCycleId },
    select: { id: true, teamType: true },
  });
  const regularTeams = teams.filter((t) => t.teamType === "REGULAR");
  const youthTeam = teams.find((t) => t.teamType === "YOUTH");

  // 2. Slots que cuentan al balance, en orden cronológico.
  const slots = await tx.serviceSlot.findMany({
    where: { monthCycleId, countsTowardBalance: true },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { id: true, slotType: true, teamsNeeded: true, date: true },
  });

  // 3. Lo que sobrevivió al borrado de arriba: únicamente asignaciones locked.
  // Sirve para (a) el conteo acumulado de partida de cada equipo y (b) saber
  // qué cupos de cada slot ya están ocupados y (c) reconstruir en qué semanas
  // ya participó cada equipo (para no repetir semana si hay alternativa).
  const lockedAssignments = await tx.slotAssignment.findMany({
    where: { monthCycleId, locked: true },
    include: { serviceSlot: { select: { date: true } } },
  });

  const countByTeam = new Map(regularTeams.map((t) => [t.id, 0]));
  // Conjunto (en memoria) de semanas (clave "year-month-day" del lunes) en
  // las que cada equipo REGULAR ya tiene una asignación — arranca con lo
  // locked, se actualiza a medida que el algoritmo asigna más turnos.
  const weeksByTeam = new Map(regularTeams.map((t) => [t.id, new Set()]));
  const lockedBySlot = new Map();
  for (const a of lockedAssignments) {
    if (countByTeam.has(a.teamId)) {
      countByTeam.set(a.teamId, countByTeam.get(a.teamId) + 1);
      const civilDate = dbDateToCivilDate(a.serviceSlot.date);
      weeksByTeam.get(a.teamId).add(weekKey(mondayOfWeek(civilDate)));
    }
    if (!lockedBySlot.has(a.serviceSlotId)) lockedBySlot.set(a.serviceSlotId, []);
    lockedBySlot.get(a.serviceSlotId).push(a);
  }

  const toCreate = [];

  for (const slot of slots) {
    const existingForSlot = lockedBySlot.get(slot.id) ?? [];
    const usedTeamIds = new Set(existingForSlot.map((a) => a.teamId));
    const usedIndexes = new Set(existingForSlot.map((a) => a.slotIndex));

    // 4a. YOUTH_SERVICE: asignación directa y fija, no compite por balance.
    if (slot.slotType === "YOUTH_SERVICE") {
      if (!youthTeam || usedTeamIds.has(youthTeam.id)) continue;
      toCreate.push({ serviceSlotId: slot.id, teamId: youthTeam.id, monthCycleId, slotIndex: 0, locked: false });
      continue;
    }

    // 4b. FIXED / EXTRAORDINARY: preferir equipos que no usaron esta semana,
    // y dentro de ese grupo (o del completo si no hay alternativa), el de
    // menor conteo acumulado.
    const slotWeekKey = weekKey(mondayOfWeek(dbDateToCivilDate(slot.date)));
    const need = slot.teamsNeeded - existingForSlot.length;
    for (let i = 0; i < need; i += 1) {
      const candidates = regularTeams.filter((t) => !usedTeamIds.has(t.id));
      if (candidates.length === 0) break; // no hay más equipos disponibles para este slot

      const sinUsarEstaSemana = candidates.filter((t) => !weeksByTeam.get(t.id).has(slotWeekKey));
      const pool = sinUsarEstaSemana.length > 0 ? sinUsarEstaSemana : candidates;

      const minCount = Math.min(...pool.map((t) => countByTeam.get(t.id)));
      const minCandidates = pool.filter((t) => countByTeam.get(t.id) === minCount);
      const chosen = pickRandom(minCandidates);

      usedTeamIds.add(chosen.id);
      countByTeam.set(chosen.id, countByTeam.get(chosen.id) + 1);
      weeksByTeam.get(chosen.id).add(slotWeekKey);

      let slotIndex = 0;
      while (usedIndexes.has(slotIndex)) slotIndex += 1;
      usedIndexes.add(slotIndex);

      toCreate.push({ serviceSlotId: slot.id, teamId: chosen.id, monthCycleId, slotIndex, locked: false });
    }
  }

  if (toCreate.length > 0) {
    await tx.slotAssignment.createMany({ data: toCreate });
  }
}
