// recomputeBalance: reparte equipos REGULAR entre los ServiceSlot que cuentan
// al balance del mes, respetando las asignaciones `locked`. Contrato cerrado
// en docs/architecture/phase1-schema-design.md §5,
// docs/architecture/phase4-schedule-contract.md §3, y refinado por
// docs/architecture/phase4b-schedule-refinements-contract.md §2 (preferir no
// repetir equipo en la misma semana ISO ANTES que el menor conteo
// acumulado) — no reinventar el algoritmo acá.
//
// Fase 4c (docs/architecture/phase4c-post-publish-edits-contract.md §6)
// agrega un modo acotado (`onlySlotIds`) para agregar un evento a un mes ya
// publicado sin reordenar nada de lo que ya estaba asignado: solo borra/
// decide los slots indicados, y arranca el conteo/semanas de partida desde
// TODO lo que sobrevive en el mes (no solo lo `locked`), porque en ese modo
// nada fuera de `onlySlotIds` se borra. El modo completo (sin `onlySlotIds`)
// sigue siendo el default, sin cambios de comportamiento: después del borrado
// completo de lo no-locked, "todo lo que sobrevive en el mes" y "lo locked"
// son exactamente el mismo conjunto, así que ambos modos comparten el mismo
// código de acá en más — no hay dos algoritmos, uno solo con un borrado/
// alcance de slots distinto según el modo.
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
 * @param {{ onlySlotIds?: string[] }} [options] Ausente/undefined: modo
 *   completo (comportamiento idéntico al histórico). Presente: modo acotado,
 *   solo decide equipo para los ServiceSlot cuyo id esté en la lista, sin
 *   tocar ninguna otra asignación del mes.
 */
export async function recomputeBalance(tx, monthCycleId, { onlySlotIds } = {}) {
  // 1. Borra las asignaciones no fijadas del mes (modo completo) o
  // únicamente las de los slots indicados (modo acotado). Las `locked: true`
  // nunca se tocan, en ningún modo.
  await tx.slotAssignment.deleteMany({
    where: {
      monthCycleId,
      locked: false,
      ...(onlySlotIds ? { serviceSlotId: { in: onlySlotIds } } : {}),
    },
  });

  const teams = await tx.team.findMany({
    where: { monthCycleId },
    select: { id: true, teamType: true },
  });
  const regularTeams = teams.filter((t) => t.teamType === "REGULAR");
  const youthTeam = teams.find((t) => t.teamType === "YOUTH");

  // 2. Slots a procesar, en orden cronológico: los que cuentan al balance
  // (modo completo) o, dentro de esos, únicamente los indicados (modo acotado).
  const slots = await tx.serviceSlot.findMany({
    where: {
      monthCycleId,
      countsTowardBalance: true,
      ...(onlySlotIds ? { id: { in: onlySlotIds } } : {}),
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { id: true, slotType: true, teamsNeeded: true, date: true },
  });

  // 3. Lo que sobrevivió al borrado de arriba. En modo completo, esto es
  // exactamente lo `locked` (todo lo demás del mes se borró en el paso 1).
  // En modo acotado, esto es TODO lo que sigue vigente en el mes (nada fuera
  // de `onlySlotIds` se tocó) — sirve para (a) el conteo acumulado de
  // partida de cada equipo, (b) qué cupos de cada slot procesado ya están
  // ocupados y (c) en qué semanas ya participó cada equipo (para no repetir
  // semana si hay alternativa), considerando SIEMPRE el mes completo.
  const survivingAssignments = await tx.slotAssignment.findMany({
    where: { monthCycleId },
    include: { serviceSlot: { select: { date: true } } },
  });

  const countByTeam = new Map(regularTeams.map((t) => [t.id, 0]));
  // Conjunto (en memoria) de semanas (clave "year-month-day" del lunes) en
  // las que cada equipo REGULAR ya tiene una asignación — arranca con lo
  // sobreviviente, se actualiza a medida que el algoritmo asigna más turnos.
  const weeksByTeam = new Map(regularTeams.map((t) => [t.id, new Set()]));
  const existingBySlot = new Map();
  for (const a of survivingAssignments) {
    if (countByTeam.has(a.teamId)) {
      countByTeam.set(a.teamId, countByTeam.get(a.teamId) + 1);
      const civilDate = dbDateToCivilDate(a.serviceSlot.date);
      weeksByTeam.get(a.teamId).add(weekKey(mondayOfWeek(civilDate)));
    }
    if (!existingBySlot.has(a.serviceSlotId)) existingBySlot.set(a.serviceSlotId, []);
    existingBySlot.get(a.serviceSlotId).push(a);
  }

  const toCreate = [];

  for (const slot of slots) {
    const existingForSlot = existingBySlot.get(slot.id) ?? [];
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
