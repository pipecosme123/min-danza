// Lógica de negocio del ciclo mensual y el sorteo de equipos. Los routers
// (routes/months.routes.js, routes/teams.routes.js) solo parsean/validan/
// serializan; toda regla vive acá. Ver docs/architecture/phase3-teams-contract.md
// (invariantes B1-B5, algoritmo sección 4 y 6).

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { shuffle } from "../utils/shuffle.js";
import { invalidateByPrefix } from "../lib/cache.js";
import { formatDbDate } from "../utils/dates.js";
import { assertEditableConsideringFinalization } from "../utils/monthLifecycle.js";

const MONTH_SELECT = {
  id: true,
  year: true,
  month: true,
  teamCount: true,
  status: true,
  finalizedAt: true,
  // Último enabled/size usados en generate-teams para el equipo de jóvenes.
  // Solo gobiernan el default que la UI precarga en el form; no afectan
  // ningún sorteo ya corrido (ver teamGeneration.service.js#generateTeams).
  youthTeamEnabled: true,
  youthTeamSize: true,
  createdAt: true,
  updatedAt: true,
};

const MEMBER_SELECT = {
  id: true,
  personId: true,
  role: true,
  manualOverride: true,
  person: { select: { fullName: true, isAdultoMayor: true } },
};

// Exportados: reusados por publicSchedule.service.js (Fase 5) para armar el
// payload público con el mismo shape que GET /api/months/:id/teams, mismo
// patrón que SLOT_SELECT/serializeSlot en scheduleGeneration.service.js.
export const TEAM_SELECT = {
  id: true,
  label: true,
  orderIndex: true,
  teamType: true,
  members: { select: MEMBER_SELECT },
};

export function serializeTeam(team) {
  return {
    id: team.id,
    label: team.label,
    orderIndex: team.orderIndex,
    teamType: team.teamType,
    members: team.members.map((m) => ({
      id: m.id,
      personId: m.personId,
      fullName: m.person.fullName,
      role: m.role,
      manualOverride: m.manualOverride,
      isAdultoMayor: m.person.isAdultoMayor,
    })),
  };
}

// ---------------------------------------------------------------------------
// MonthCycle
// ---------------------------------------------------------------------------

export async function listMonthCycles() {
  const months = await prisma.monthCycle.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: MONTH_SELECT,
  });
  return { data: months };
}

export async function createMonthCycle({ year, month, teamCount }) {
  const existing = await prisma.monthCycle.findUnique({
    where: { year_month: { year, month } },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("Ya existe un mes creado para ese año/mes.", {
      code: "MES_YA_EXISTE",
      monthCycleId: existing.id,
    });
  }

  try {
    return await prisma.monthCycle.create({
      data: { year, month, teamCount },
      select: MONTH_SELECT,
    });
  } catch (err) {
    // Carrera: dos POST /api/months concurrentes con el mismo (year, month)
    // pueden pasar ambos el findUnique de arriba (no está en una transacción
    // serializable) antes de que el primero confirme; el segundo choca con
    // el índice único `@@unique([year, month])` recién al escribir. Mismo
    // patrón que la carrera de POST /api/people (ver people.service.js):
    // se traduce al MISMO 409 MES_YA_EXISTE estructurado del camino
    // secuencial, en vez de dejar pasar el P2002 crudo al errorHandler
    // genérico (que respondería 409 sin `details.code`).
    if (err?.code === "P2002") {
      const clashing = await prisma.monthCycle.findUnique({
        where: { year_month: { year, month } },
        select: { id: true },
      });
      if (clashing) {
        throw new ConflictError("Ya existe un mes creado para ese año/mes.", {
          code: "MES_YA_EXISTE",
          monthCycleId: clashing.id,
        });
      }
    }
    throw err;
  }
}

export async function getMonthCycle(id) {
  const month = await prisma.monthCycle.findUnique({ where: { id }, select: MONTH_SELECT });
  if (!month) throw new NotFoundError("Mes no encontrado.");
  return month;
}

// ---------------------------------------------------------------------------
// POST /api/months/:id/finalize
// ---------------------------------------------------------------------------

/**
 * Publica un mes: DRAFT -> FINALIZED. No hay vuelta atrás en esta fase (ver
 * docs/architecture/phase5-public-page-contract.md §0/§5). No agrega ningún
 * candado nuevo -- el chequeo MES_FINALIZADO que protege generate-teams,
 * generate-schedule, eventos y asignaciones ya existe desde Fase 3-4 y pasa
 * a aplicar apenas cambia el status.
 *
 * Ajustado 2026-08-22: además de equipos+horario (MES_INCOMPLETO), exige que
 * NINGÚN turno no cancelado (FIXED/EXTRAORDINARY/YOUTH_SERVICE) esté sin
 * uniforme asignado (TURNOS_SIN_UNIFORME) -- no tiene sentido publicar un
 * horario donde no se sabe qué usar en algún servicio.
 */
export async function finalizeMonthCycle(id) {
  // Envuelto en $transaction (mismo estilo que generateTeams/updateTeam de
  // este archivo): lee estado + cuenta equipos/slots + escribe el nuevo
  // status de forma atómica, en vez de en pasos sueltos que otra escritura
  // concurrente (p. ej. un borrado de equipos por re-sorteo) podría intercalar.
  const updated = await prisma.$transaction(async (tx) => {
    const month = await tx.monthCycle.findUnique({ where: { id } });
    if (!month) throw new NotFoundError("Mes no encontrado.");

    if (month.status === "FINALIZED") {
      throw new ConflictError("El mes ya está finalizado.", { code: "MES_YA_FINALIZADO" });
    }

    const [teamCount, slotCount] = await Promise.all([
      tx.team.count({ where: { monthCycleId: id, teamType: "REGULAR" } }),
      tx.serviceSlot.count({ where: { monthCycleId: id } }),
    ]);

    const hasTeams = teamCount > 0;
    const hasSchedule = slotCount > 0;

    if (!hasTeams || !hasSchedule) {
      throw new ConflictError("El mes todavía no tiene equipos y/o horario; no se puede finalizar.", {
        code: "MES_INCOMPLETO",
        hasTeams,
        hasSchedule,
      });
    }

    // Ningún turno (FIXED/EXTRAORDINARY/YOUTH_SERVICE) puede quedar sin
    // uniforme asignado para poder publicar el mes -- salvo los cancelados
    // (cancelledAt no nulo), que ya no necesitan equipo ni cuentan al
    // balance, así que tampoco tiene sentido exigirles uniforme.
    const slotsWithoutUniform = await tx.serviceSlot.findMany({
      where: { monthCycleId: id, uniformId: null, cancelledAt: null },
      select: { id: true, date: true, startTime: true, slotType: true, title: true },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    if (slotsWithoutUniform.length > 0) {
      throw new ConflictError(
        "Hay turnos sin uniforme asignado; no se puede finalizar el mes hasta asignarlos todos.",
        {
          code: "TURNOS_SIN_UNIFORME",
          slots: slotsWithoutUniform.map((s) => ({
            id: s.id,
            date: formatDbDate(s.date),
            startTime: s.startTime,
            slotType: s.slotType,
            title: s.title,
          })),
        }
      );
    }

    return tx.monthCycle.update({
      where: { id },
      data: { status: "FINALIZED", finalizedAt: new Date() },
      select: MONTH_SELECT,
    });
  });

  // Defensivo (ver contrato §1): un mes recién finalizado nunca estuvo
  // cacheado antes bajo su clave pública, pero invalidar es barato y evita
  // sorpresas si en el futuro se agrega "des-finalizar". Fuera de la
  // transacción a propósito: es un efecto en memoria del proceso, no una
  // escritura de base que deba ser atómica con lo anterior.
  invalidateByPrefix("schedule:");

  return updated;
}

// ---------------------------------------------------------------------------
// DELETE /api/months/:id
// ---------------------------------------------------------------------------

/**
 * Elimina un MonthCycle por completo -- equipos, horario y asignaciones
 * caen en cascada a nivel de base de datos (onDelete: Cascade en
 * schema.prisma), no hace falta borrado manual multi-tabla.
 *
 * - DRAFT: sin restricción, nunca se publicó en ningún lado.
 * - FINALIZED: mismo criterio que agregar/cancelar eventos y cambiar
 *   uniforme tras publicar -- solo el mes actual o uno futuro
 *   (`assertEditableConsideringFinalization`), 409 MES_PASADO si ya pasó.
 *   Protege el historial público de hasta 1 año (ver
 *   docs/architecture/phase5-public-page-contract.md §0).
 */
export async function deleteMonthCycle(id) {
  const month = await prisma.monthCycle.findUnique({
    where: { id },
    select: { id: true, year: true, month: true, status: true },
  });
  if (!month) throw new NotFoundError("Mes no encontrado.");

  assertEditableConsideringFinalization(month);

  await prisma.monthCycle.delete({ where: { id } });

  // Defensivo, mismo patrón que finalizeMonthCycle: barato, evita servir
  // desde caché un mes que ya no existe si estaba publicado.
  invalidateByPrefix("schedule:");

  return { deleted: true };
}

async function loadMonthOrThrow(tx, id) {
  const month = await tx.monthCycle.findUnique({ where: { id } });
  if (!month) throw new NotFoundError("Mes no encontrado.");
  return month;
}

function assertDraft(month) {
  if (month.status !== "DRAFT") {
    throw new ConflictError("El mes ya está finalizado y no admite cambios.", { code: "MES_FINALIZADO" });
  }
}

// ---------------------------------------------------------------------------
// Sorteo — generate-teams
// ---------------------------------------------------------------------------

/**
 * @param {string} monthCycleId
 * @param {{ youthTeam?: { enabled: boolean, size?: number, leaderPersonId?: string }, teamCount?: number }} [options]
 */
export async function generateTeams(monthCycleId, options = {}) {
  try {
    return await generateTeamsTransaction(monthCycleId, options);
  } catch (err) {
    // Carrera: dos POST /months/:id/generate-teams concurrentes sobre el
    // MISMO mes pueden pasar ambos el assertDraft(month) de arriba (leído
    // fuera de un lock) antes de que el primero confirme su transacción. El
    // segundo, al intentar escribir sus propios `Team` con
    // `orderIndex`/`label` ya tomados por los del primero (índices únicos
    // `@@unique([monthCycleId, orderIndex])` / `@@unique([monthCycleId, label])`
    // — ver prisma/schema.prisma), choca con P2002 recién al escribir, no
    // antes. No hay un código de error ya establecido en el resto del
    // proyecto para "dos escrituras destructivas de la misma operación
    // corriendo a la vez" (a diferencia de MES_YA_EXISTE/DOCUMENTO_DUPLICADO/
    // UNIFORME_DUPLICADO/EQUIPO_EDITADO_CONCURRENTEMENTE, que son duplicados
    // de un recurso), así que se traduce a un código nuevo específico:
    // 409 SORTEO_EN_CURSO. Ver docs/architecture/phase3-teams-contract.md §0.
    if (err?.code === "P2002") {
      throw new ConflictError(
        "Ya se está generando el sorteo de este mes en otra pestaña o solicitud; esperá a que termine y volvé a intentar.",
        { code: "SORTEO_EN_CURSO" }
      );
    }
    throw err;
  }
}

async function generateTeamsTransaction(monthCycleId, options = {}) {
  const { youthTeam, teamCount: requestedTeamCount } = options;

  return prisma.$transaction(async (tx) => {
    const month = await loadMonthOrThrow(tx, monthCycleId);
    assertDraft(month);

    const instructorPool = await tx.person.findMany({
      where: { active: true, category: "INSTRUCTOR" },
      select: { id: true, isAdultoMayor: true },
    });
    const ministroPool = await tx.person.findMany({
      where: { active: true, category: "MINISTRO" },
      select: { id: true, isAdultoMayor: true },
    });

    // Ajustado 2026-08-22: permite elegir de nuevo la cantidad de equipos al
    // (re)sortear (`requestedTeamCount`), sin tener que borrar el mes y crear
    // uno nuevo. Si no viene, se sortea con el `teamCount` que el mes ya
    // tenía (comportamiento histórico). El re-sorteo ya borra y recrea TODOS
    // los equipos (y el horario, si existía) sin importar si la cantidad
    // cambió, así que no hace falta ningún manejo especial para achicar o
    // agrandar la cantidad de equipos.
    const teamCount = requestedTeamCount ?? month.teamCount;

    if (instructorPool.length < teamCount) {
      throw new ConflictError("No hay suficientes instructores activos para formar los equipos.", {
        code: "POOL_INSTRUCTOR_INSUFICIENTE",
        available: instructorPool.length,
        needed: teamCount,
      });
    }

    // Paso 2-3: mes anterior estricto (year, month) y sus líderes.
    const previousCycle = await tx.monthCycle.findFirst({
      where: {
        OR: [{ year: { lt: month.year } }, { year: month.year, month: { lt: month.month } }],
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { id: true },
    });

    let previousLeaderIds = new Set();
    if (previousCycle) {
      const previousLeaders = await tx.teamMember.findMany({
        where: { monthCycleId: previousCycle.id, role: "LEADER" },
        select: { personId: true },
      });
      previousLeaderIds = new Set(previousLeaders.map((l) => l.personId));
    }

    const warnings = [];

    // Paso 4: pool preferido = instructores menos líderes del mes anterior.
    const preferredLeaderPool = instructorPool.filter((p) => !previousLeaderIds.has(p.id));

    let leaderSourcePool;
    if (preferredLeaderPool.length >= teamCount) {
      leaderSourcePool = preferredLeaderPool;
    } else {
      leaderSourcePool = instructorPool;
      warnings.push({
        code: "LIDER_REPETIDO_POSIBLE",
        message:
          "No había suficientes instructores fuera del liderazgo del mes anterior; se relajó la restricción y es posible que se repita algún líder.",
      });
    }

    // Paso 5: barajar y tomar los primeros teamCount como líderes.
    const shuffledLeaderSource = shuffle(leaderSourcePool);
    const leaders = shuffledLeaderSource.slice(0, teamCount);
    const leaderIdSet = new Set(leaders.map((p) => p.id));

    // Paso 6: resto de instructores (no sorteados como líder) -> SUPPORT
    // round-robin, con los isAdultoMayor repartidos primero dentro del pool
    // para que ningún equipo se lleve más de 1 de diferencia (ver
    // docs/architecture/phase3-teams-contract.md, sección Algoritmo).
    const remainingInstructors = instructorPool.filter((p) => !leaderIdSet.has(p.id));
    const shuffledSupport = shuffle(remainingInstructors);
    const amSupport = shuffledSupport.filter((p) => p.isAdultoMayor);
    const restSupport = shuffledSupport.filter((p) => !p.isAdultoMayor);
    const orderedSupport = [...amSupport, ...restSupport];

    // Offset compartido: SIEMPRE se sortea (nunca condicional a si hay AM en
    // ESTE pool), porque el pool de colaboradores lo va a necesitar igual
    // para no arrancar siempre en el mismo equipo -- si acá se hiciera
    // condicional a `amSupport.length > 0`, un mes con AM solo entre
    // ministros heredaría un offset fijo en 0 y el Equipo 1 acumularía sesgo
    // determinista mes a mes.
    const sharedBase = Math.floor(Math.random() * teamCount);

    // Paso 7: ministros -> COLLABORATOR round-robin, misma idea, continuando
    // la rotación donde la dejó el pool de apoyo (no reinicia en 0) -- así el
    // desbalance COMBINADO de adultos mayores entre apoyo+colaborador por
    // equipo queda acotado a ±1, igual que ya lo está cada pool por separado.
    const shuffledCollaborators = shuffle(ministroPool);
    const amCollab = shuffledCollaborators.filter((p) => p.isAdultoMayor);
    const restCollab = shuffledCollaborators.filter((p) => !p.isAdultoMayor);
    const orderedCollaborators = [...amCollab, ...restCollab];
    const collabBase = (sharedBase + amSupport.length) % teamCount;

    // --- Equipo de jóvenes (YOUTH), si se pidió. TODO se valida antes de
    // escribir nada (mismo criterio que POOL_INSTRUCTOR_INSUFICIENTE arriba):
    // un error acá no debe dejar a medio camino los equipos regulares. ---
    const youthEnabled = Boolean(youthTeam?.enabled);
    let youthPlan = null;

    if (youthEnabled) {
      const leaderPersonId = youthTeam.leaderPersonId;
      const size = youthTeam.size ?? 10;

      const leaderPerson = leaderPersonId
        ? await tx.person.findUnique({
            where: { id: leaderPersonId },
            select: { id: true, active: true, isJoven: true },
          })
        : null;

      if (!leaderPerson || !leaderPerson.active || !leaderPerson.isJoven) {
        throw new ValidationError(
          "El líder del equipo de jóvenes debe ser una persona activa marcada como joven (isJoven: true).",
          { code: "LIDER_JOVENES_INVALIDO" }
        );
      }

      // Pool de colaboradores: activos + isJoven, sin filtrar por category
      // (INSTRUCTOR o MINISTRO da igual), excluyendo al líder ya elegido.
      const jovenPool = await tx.person.findMany({
        where: { active: true, isJoven: true, id: { not: leaderPersonId } },
        select: { id: true },
      });

      const totalAvailable = jovenPool.length + 1; // + el líder
      if (totalAvailable < size) {
        throw new ConflictError(
          "No hay suficientes personas activas marcadas como joven para formar el equipo de jóvenes.",
          { code: "POOL_JOVENES_INSUFICIENTE", available: totalAvailable, needed: size }
        );
      }

      const neededCollaborators = size - 1;

      // Mismo criterio de "mes anterior" que previousCycle arriba: priorizar
      // a quienes NO estuvieron en el equipo YOUTH de ese mes.
      let previousYouthMemberIds = new Set();
      if (previousCycle) {
        const previousYouthMembers = await tx.teamMember.findMany({
          where: { monthCycleId: previousCycle.id, teamType: "YOUTH" },
          select: { personId: true },
        });
        previousYouthMemberIds = new Set(previousYouthMembers.map((m) => m.personId));
      }

      const preferredJovenPool = jovenPool.filter((p) => !previousYouthMemberIds.has(p.id));

      let jovenSourcePool;
      if (preferredJovenPool.length >= neededCollaborators) {
        jovenSourcePool = preferredJovenPool;
      } else {
        jovenSourcePool = jovenPool;
        warnings.push({
          code: "JOVENES_REPETIDOS_POSIBLE",
          message:
            "No había suficientes jóvenes fuera del equipo de jóvenes del mes anterior; se relajó la restricción y es posible que se repita alguno.",
        });
      }

      const shuffledJovenSource = shuffle(jovenSourcePool);
      const chosenCollaborators = shuffledJovenSource.slice(0, neededCollaborators);

      youthPlan = { leaderPersonId, collaborators: chosenCollaborators };
    }

    // Paso 7.5: si el mes ya tenía horario generado (Fase 4), se pierde con
    // el re-sorteo — los equipos que ese horario tenía asignados ya no
    // existirán. Se borra explícitamente (en vez de dejarlo huérfano) y se
    // avisa con un warning; ver docs/architecture/phase4-schedule-contract.md §9.
    const existingSlotCount = await tx.serviceSlot.count({ where: { monthCycleId } });
    if (existingSlotCount > 0) {
      await tx.serviceSlot.deleteMany({ where: { monthCycleId } });
      warnings.push({
        code: "HORARIO_BORRADO_POR_RESORTEO",
        message: "Se borró el horario del mes porque los equipos cambiaron. Volvé a generarlo desde la sección de Eventos.",
      });
    }

    // Paso 8: transacción — borrar equipos existentes (regulares + YOUTH,
    // cascada borra sus TeamMember), crear equipos nuevos, crear miembros.
    await tx.team.deleteMany({ where: { monthCycleId } });

    const teams = [];
    for (let i = 0; i < teamCount; i += 1) {
      const team = await tx.team.create({
        data: {
          monthCycleId,
          label: `Equipo ${i + 1}`,
          orderIndex: i + 1,
          teamType: "REGULAR",
        },
      });
      teams.push(team);
    }

    const memberRows = [];

    leaders.forEach((person, i) => {
      memberRows.push({
        teamId: teams[i].id,
        monthCycleId,
        personId: person.id,
        role: "LEADER",
        manualOverride: false,
        teamType: "REGULAR",
      });
    });

    orderedSupport.forEach((person, i) => {
      const team = teams[(sharedBase + i) % teamCount];
      memberRows.push({
        teamId: team.id,
        monthCycleId,
        personId: person.id,
        role: "SUPPORT",
        manualOverride: false,
        teamType: "REGULAR",
      });
    });

    orderedCollaborators.forEach((person, i) => {
      const team = teams[(collabBase + i) % teamCount];
      memberRows.push({
        teamId: team.id,
        monthCycleId,
        personId: person.id,
        role: "COLLABORATOR",
        manualOverride: false,
        teamType: "REGULAR",
      });
    });

    if (youthPlan) {
      const youthTeamRow = await tx.team.create({
        data: {
          monthCycleId,
          label: "Servicio de jóvenes",
          orderIndex: teamCount + 1,
          teamType: "YOUTH",
        },
      });
      teams.push(youthTeamRow);

      memberRows.push({
        teamId: youthTeamRow.id,
        monthCycleId,
        personId: youthPlan.leaderPersonId,
        role: "LEADER",
        // El líder del equipo de jóvenes SIEMPRE se elige a mano (nunca por
        // sorteo automático) -> manualOverride true, a diferencia de los
        // líderes regulares de arriba.
        manualOverride: true,
        teamType: "YOUTH",
      });

      youthPlan.collaborators.forEach((person) => {
        memberRows.push({
          teamId: youthTeamRow.id,
          monthCycleId,
          personId: person.id,
          role: "COLLABORATOR",
          manualOverride: false,
          teamType: "YOUTH",
        });
      });
    }

    if (memberRows.length > 0) {
      await tx.teamMember.createMany({ data: memberRows });
    }

    // Persiste el teamCount efectivo (puede ser el nuevo, si vino en el
    // body) y el último enabled/size pedidos como default para el próximo
    // form (ver comentario en MONTH_SELECT); no afecta al sorteo que ya
    // quedó fijado arriba. Si esta llamada vino con youthTeam.enabled false
    // (o ausente), se conserva el último tamaño conocido para no perder el
    // valor que la UI venía mostrando.
    await tx.monthCycle.update({
      where: { id: monthCycleId },
      data: {
        teamCount,
        youthTeamEnabled: youthEnabled,
        youthTeamSize: youthEnabled ? youthTeam.size ?? 10 : month.youthTeamSize,
      },
    });

    const fullTeams = await tx.team.findMany({
      where: { monthCycleId },
      orderBy: { orderIndex: "asc" },
      select: TEAM_SELECT,
    });

    return {
      teams: fullTeams.map(serializeTeam),
      warnings,
    };
  });
}

// ---------------------------------------------------------------------------
// GET /api/months/:id/teams
// ---------------------------------------------------------------------------

export async function listTeamsForMonth(monthCycleId) {
  const month = await prisma.monthCycle.findUnique({ where: { id: monthCycleId }, select: { id: true } });
  if (!month) throw new NotFoundError("Mes no encontrado.");

  const teams = await prisma.team.findMany({
    where: { monthCycleId },
    orderBy: { orderIndex: "asc" },
    select: TEAM_SELECT,
  });

  return { teams: teams.map(serializeTeam) };
}

// ---------------------------------------------------------------------------
// PATCH /api/teams/:teamId
// ---------------------------------------------------------------------------

export async function updateTeam(teamId, members) {
  try {
    return await updateTeamTransaction(teamId, members);
  } catch (err) {
    // Carrera: dos PATCH concurrentes sobre el mismo equipo (doble clic,
    // dos pestañas) pueden pasar ambos las validaciones de arriba antes de
    // que el primero confirme, y el segundo choca con alguno de los índices
    // únicos (uno de ellos parcial: team_member_one_leader_per_team) recién
    // al escribir. Mismo patrón que la carrera de POST /api/people
    // (ver people.service.js): se traduce a un 409 legible en vez de dejar
    // pasar el P2002 crudo al errorHandler genérico.
    if (err?.code === "P2002") {
      throw new ConflictError(
        "No se pudo guardar: otra edición de este equipo se aplicó al mismo tiempo. Volvé a intentarlo.",
        { code: "EQUIPO_EDITADO_CONCURRENTEMENTE" }
      );
    }
    throw err;
  }
}

async function updateTeamTransaction(teamId, members) {
  return prisma.$transaction(async (tx) => {
    const team = await tx.team.findUnique({
      where: { id: teamId },
      include: { monthCycle: { select: { id: true, year: true, month: true, status: true } } },
    });
    if (!team) throw new NotFoundError("Equipo no encontrado.", { code: "EQUIPO_NO_ENCONTRADO" });
    assertEditableConsideringFinalization(team.monthCycle);

    const monthCycleId = team.monthCycleId;

    // El equipo YOUTH solo admite LEADER/COLLABORATOR: nunca tuvo (ni tiene)
    // un pool de "apoyo" separado, a diferencia de los equipos REGULAR.
    if (team.teamType === "YOUTH" && members.some((m) => m.role === "SUPPORT")) {
      throw new ValidationError("El equipo de jóvenes no admite el rol SUPPORT.", {
        code: "ROL_INVALIDO_EQUIPO_JOVENES",
      });
    }

    if (members.length > 0) {
      const leaderCount = members.filter((m) => m.role === "LEADER").length;
      if (leaderCount === 0) {
        throw new ValidationError("El equipo debe tener exactamente un líder.", { code: "EQUIPO_SIN_LIDER" });
      }
      if (leaderCount > 1) {
        throw new ValidationError("El equipo no puede tener más de un líder.", {
          code: "EQUIPO_MULTIPLES_LIDERES",
        });
      }
    }

    const personIds = members.map((m) => m.personId);
    const people =
      personIds.length > 0
        ? await tx.person.findMany({
            where: { id: { in: personIds } },
            select: { id: true, category: true, active: true },
          })
        : [];
    const peopleById = new Map(people.map((p) => [p.id, p]));

    for (const m of members) {
      const person = peopleById.get(m.personId);
      if (!person || !person.active) {
        throw new ValidationError("La persona indicada no existe o no está activa.", {
          code: "PERSONA_NO_VALIDA",
          personId: m.personId,
        });
      }
    }

    // Paso 2: si la persona hoy pertenece a OTRO equipo del MISMO tipo en el
    // mismo mes, borrar esa fila (se "muda"). Filtrado por teamType a
    // propósito: una persona puede estar en su equipo REGULAR y en el
    // equipo YOUTH el mismo mes a la vez (ver índice único parcial
    // team_member_one_regular_team_per_person), así que editar un equipo de
    // un tipo nunca debe tocar la membresía del otro tipo.
    if (personIds.length > 0) {
      await tx.teamMember.deleteMany({
        where: {
          monthCycleId,
          personId: { in: personIds },
          teamId: { not: teamId },
          teamType: team.teamType,
        },
      });
    }

    // Paso 3: borrar del equipo editado los miembros que ya no están en el body.
    await tx.teamMember.deleteMany({
      where: {
        teamId,
        ...(personIds.length > 0 ? { personId: { notIn: personIds } } : {}),
      },
    });

    // Paso 4: upsert el resto. Los no-LEADER van primero: la base tiene un
    // índice único parcial (team_member_one_leader_per_team, sobre team_id
    // WHERE role = 'LEADER') que protege la invariante B2 a nivel de datos.
    // Si el nuevo líder se escribiera antes de degradar al anterior, habría
    // un instante con dos filas LEADER en el mismo equipo y Postgres
    // rechazaría el UPDATE con P2002 — por eso las bajas de LEADER SIEMPRE
    // se aplican antes que los ascensos a LEADER, nunca en el orden en que
    // llegó el body.
    const orderedMembers = [...members].sort(
      (a, b) => Number(a.role === "LEADER") - Number(b.role === "LEADER")
    );
    for (const m of orderedMembers) {
      const person = peopleById.get(m.personId);
      let manualOverride;
      if (team.teamType === "YOUTH") {
        // El equipo de jóvenes no tiene "categoría esperada" por rol (isJoven
        // es independiente de category, y el sorteo automático de jóvenes
        // nunca pasa por este PATCH): cualquier edición manual de su roster
        // es, por definición, una excepción manual.
        manualOverride = true;
      } else {
        const expectedCategory = m.role === "COLLABORATOR" ? "MINISTRO" : "INSTRUCTOR";
        manualOverride = person.category !== expectedCategory;
      }

      const existingMember = await tx.teamMember.findUnique({
        where: { teamId_personId: { teamId, personId: m.personId } },
      });

      if (existingMember) {
        await tx.teamMember.update({
          where: { id: existingMember.id },
          data: { role: m.role, manualOverride },
        });
      } else {
        await tx.teamMember.create({
          data: {
            teamId,
            monthCycleId,
            personId: m.personId,
            role: m.role,
            manualOverride,
            teamType: team.teamType,
          },
        });
      }
    }

    const updated = await tx.team.findUnique({
      where: { id: teamId },
      select: TEAM_SELECT,
    });

    // Fase 4c: este endpoint ahora puede mutar un mes FINALIZED
    // (actual/futuro), que puede estar cacheado como página pública. Este
    // archivo no puede importar cacheKeyFor de publicSchedule.service.js sin
    // cerrar un ciclo de imports (publicSchedule.service.js ya importa
    // TEAM_SELECT/serializeTeam de acá) -- se usa invalidateByPrefix, ya
    // importado en este mismo archivo para deleteMonthCycle/finalizeMonthCycle,
    // un poco más ancho que la clave puntual pero sin tocar la arquitectura
    // de módulos existente.
    invalidateByPrefix("schedule:");

    return { team: serializeTeam(updated) };
  });
}
