// Lógica de negocio del ciclo mensual y el sorteo de equipos. Los routers
// (routes/months.routes.js, routes/teams.routes.js) solo parsean/validan/
// serializan; toda regla vive acá. Ver docs/architecture/phase3-teams-contract.md
// (invariantes B1-B5, algoritmo sección 4 y 6).

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { shuffle } from "../utils/shuffle.js";

const MONTH_SELECT = {
  id: true,
  year: true,
  month: true,
  teamCount: true,
  status: true,
  finalizedAt: true,
  createdAt: true,
  updatedAt: true,
};

const MEMBER_SELECT = {
  id: true,
  personId: true,
  role: true,
  manualOverride: true,
  person: { select: { fullName: true } },
};

const TEAM_SELECT = {
  id: true,
  label: true,
  orderIndex: true,
  members: { select: MEMBER_SELECT },
};

function serializeTeam(team) {
  return {
    id: team.id,
    label: team.label,
    orderIndex: team.orderIndex,
    members: team.members.map((m) => ({
      id: m.id,
      personId: m.personId,
      fullName: m.person.fullName,
      role: m.role,
      manualOverride: m.manualOverride,
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

  return prisma.monthCycle.create({
    data: { year, month, teamCount },
    select: MONTH_SELECT,
  });
}

export async function getMonthCycle(id) {
  const month = await prisma.monthCycle.findUnique({ where: { id }, select: MONTH_SELECT });
  if (!month) throw new NotFoundError("Mes no encontrado.");
  return month;
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

export async function generateTeams(monthCycleId) {
  return prisma.$transaction(async (tx) => {
    const month = await loadMonthOrThrow(tx, monthCycleId);
    assertDraft(month);

    const instructorPool = await tx.person.findMany({
      where: { active: true, category: "INSTRUCTOR" },
      select: { id: true },
    });
    const ministroPool = await tx.person.findMany({
      where: { active: true, category: "MINISTRO" },
      select: { id: true },
    });

    const { teamCount } = month;

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

    // Paso 6: resto de instructores (no sorteados como líder) -> SUPPORT round-robin.
    const remainingInstructors = instructorPool.filter((p) => !leaderIdSet.has(p.id));
    const shuffledSupport = shuffle(remainingInstructors);

    // Paso 7: ministros -> COLLABORATOR round-robin.
    const shuffledCollaborators = shuffle(ministroPool);

    // Paso 8: transacción — borrar equipos existentes, crear equipos nuevos, crear miembros.
    await tx.team.deleteMany({ where: { monthCycleId } });

    const teams = [];
    for (let i = 0; i < teamCount; i += 1) {
      const team = await tx.team.create({
        data: {
          monthCycleId,
          label: `Equipo ${i + 1}`,
          orderIndex: i + 1,
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
      });
    });

    shuffledSupport.forEach((person, i) => {
      const team = teams[i % teamCount];
      memberRows.push({
        teamId: team.id,
        monthCycleId,
        personId: person.id,
        role: "SUPPORT",
        manualOverride: false,
      });
    });

    shuffledCollaborators.forEach((person, i) => {
      const team = teams[i % teamCount];
      memberRows.push({
        teamId: team.id,
        monthCycleId,
        personId: person.id,
        role: "COLLABORATOR",
        manualOverride: false,
      });
    });

    if (memberRows.length > 0) {
      await tx.teamMember.createMany({ data: memberRows });
    }

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
      include: { monthCycle: { select: { id: true, status: true } } },
    });
    if (!team) throw new NotFoundError("Equipo no encontrado.", { code: "EQUIPO_NO_ENCONTRADO" });
    if (team.monthCycle.status !== "DRAFT") {
      throw new ConflictError("El mes ya está finalizado y no admite cambios.", { code: "MES_FINALIZADO" });
    }

    const monthCycleId = team.monthCycleId;

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

    // Paso 2: si la persona hoy pertenece a OTRO equipo del mismo mes, borrar esa fila.
    if (personIds.length > 0) {
      await tx.teamMember.deleteMany({
        where: {
          monthCycleId,
          personId: { in: personIds },
          teamId: { not: teamId },
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
      const expectedCategory = m.role === "COLLABORATOR" ? "MINISTRO" : "INSTRUCTOR";
      const manualOverride = person.category !== expectedCategory;

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
          },
        });
      }
    }

    const updated = await tx.team.findUnique({
      where: { id: teamId },
      select: TEAM_SELECT,
    });

    return { team: serializeTeam(updated) };
  });
}
