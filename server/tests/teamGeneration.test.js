// POST /api/months/:id/generate-teams, GET /api/months/:id/teams,
// PATCH /api/teams/:teamId. Contrato completo en
// docs/architecture/phase3-teams-contract.md. Golpea la base Postgres real
// de desarrollo (igual que people.crud.test.js).
//
// El pool de sorteo (instructorPool/ministroPool) es GLOBAL a toda persona
// activa de la base, no está acotado a un mes — así que para que las
// aserciones de sorteo (exclusión de líder anterior, relajación, reparto
// parejo) sean deterministas, este archivo desactiva temporalmente a
// cualquier INSTRUCTOR/MINISTRO activo preexistente en beforeAll y lo
// restaura en afterAll, trabajando solo con personas creadas por este mismo
// archivo (prefijo QA TEAMGEN) durante el resto de la corrida.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA TEAMGEN";
const DOC_PREFIX = `QATG${RUN_ID}`;
let docCounter = 0;

let token;
const createdPersonIds = [];
const createdMonthCycleIds = [];
let preExistingActiveIds = [];

beforeAll(async () => {
  const res = await request(app).post("/api/auth/login").send({ username: REAL_USERNAME, password: REAL_PASSWORD });
  token = res.body.token;

  // Aislar el pool de sorteo: desactivar temporalmente cualquier
  // INSTRUCTOR/MINISTRO activo preexistente (datos reales del entorno de
  // desarrollo o dejados por otro archivo de test).
  const preExisting = await prisma.person.findMany({
    where: { active: true, category: { in: ["INSTRUCTOR", "MINISTRO"] } },
    select: { id: true },
  });
  preExistingActiveIds = preExisting.map((p) => p.id);
  if (preExistingActiveIds.length > 0) {
    await prisma.person.updateMany({ where: { id: { in: preExistingActiveIds } }, data: { active: false } });
  }
});

afterAll(async () => {
  await prisma.teamMember.deleteMany({
    where: { OR: [{ personId: { in: createdPersonIds } }, { monthCycleId: { in: createdMonthCycleIds } }] },
  });
  await prisma.team.deleteMany({ where: { monthCycleId: { in: createdMonthCycleIds } } });
  await prisma.monthCycle.deleteMany({ where: { id: { in: createdMonthCycleIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.person.deleteMany({ where: { fullName: { startsWith: NAME_PREFIX } } });

  if (preExistingActiveIds.length > 0) {
    await prisma.person.updateMany({ where: { id: { in: preExistingActiveIds } }, data: { active: true } });
  }

  await prisma.$disconnect();
});

function authed(req) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function makePerson(category, suffix, opts = {}) {
  docCounter += 1;
  const person = await prisma.person.create({
    data: {
      fullName: `${NAME_PREFIX} ${suffix}`,
      documentId: `${DOC_PREFIX}${docCounter}`,
      category,
      isJoven: opts.isJoven ?? false,
      active: true,
    },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function retire(people) {
  await prisma.person.updateMany({ where: { id: { in: people.map((p) => p.id) } }, data: { active: false } });
}

async function createMonth(year, month, teamCount) {
  const res = await authed(request(app).post("/api/months")).send({ year, month, teamCount });
  expect(res.status).toBe(201);
  createdMonthCycleIds.push(res.body.id);
  return res.body;
}

describe("POST /api/months/:id/generate-teams", () => {
  it("sortea equipos con pool suficiente: 1 líder por equipo, y reparte apoyo/colaboradores parejo", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 6 }, (_, i) => makePerson("INSTRUCTOR", `Sorteo Instr ${i + 1}`))
    );
    const ministros = await Promise.all(
      Array.from({ length: 9 }, (_, i) => makePerson("MINISTRO", `Sorteo Min ${i + 1}`))
    );

    const month = await createMonth(2073, 1, 3);
    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`));

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
    expect(res.body.teams).toHaveLength(3);

    let totalLeaders = 0;
    let totalSupport = 0;
    let totalCollaborators = 0;
    const supportPerTeam = [];
    const collabPerTeam = [];

    for (const team of res.body.teams) {
      const leaders = team.members.filter((m) => m.role === "LEADER");
      const support = team.members.filter((m) => m.role === "SUPPORT");
      const collaborators = team.members.filter((m) => m.role === "COLLABORATOR");
      expect(leaders).toHaveLength(1);
      totalLeaders += leaders.length;
      totalSupport += support.length;
      totalCollaborators += collaborators.length;
      supportPerTeam.push(support.length);
      collabPerTeam.push(collaborators.length);
      expect(team.members.every((m) => m.manualOverride === false)).toBe(true);
    }

    expect(totalLeaders).toBe(3);
    expect(totalSupport).toBe(3); // 6 instructores - 3 líderes = 3 de apoyo
    expect(totalCollaborators).toBe(9);
    // Reparto parejo round-robin: 3 equipos, 3 de apoyo -> 1 cada uno; 9 ministros -> 3 cada uno.
    expect(supportPerTeam.sort()).toEqual([1, 1, 1]);
    expect(collabPerTeam.sort()).toEqual([3, 3, 3]);

    await retire([...instructors, ...ministros]);
  });

  it("409 POOL_INSTRUCTOR_INSUFICIENTE si no hay suficientes instructores activos", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 2 }, (_, i) => makePerson("INSTRUCTOR", `Insuf Instr ${i + 1}`))
    );

    const month = await createMonth(2073, 2, 5);
    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`));

    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("POOL_INSTRUCTOR_INSUFICIENTE");
    expect(res.body.error.details.available).toBe(2);
    expect(res.body.error.details.needed).toBe(5);

    await retire(instructors);
  });

  it("excluye al líder del mes anterior cuando el pool preferido alcanza (sin warning)", async () => {
    // Mes A: exactamente teamCount instructores -> todos terminan de líder (determinista).
    const monthA = await createMonth(2074, 1, 4);
    const groupA = await Promise.all(
      Array.from({ length: 4 }, (_, i) => makePerson("INSTRUCTOR", `Excl A ${i + 1}`))
    );
    const genA = await authed(request(app).post(`/api/months/${monthA.id}/generate-teams`));
    expect(genA.status).toBe(200);
    const leaderIdsA = genA.body.teams.flatMap((t) => t.members.filter((m) => m.role === "LEADER").map((m) => m.personId));
    expect(leaderIdsA.sort()).toEqual(groupA.map((p) => p.id).sort());

    // Mes B: se agregan 4 instructores nuevos (mismo tamaño que teamCount) sin
    // retirar al grupo A -> preferredLeaderPool = grupo B (tamaño == teamCount),
    // así que el sorteo, sin ambigüedad, debe elegir exactamente al grupo B.
    const monthB = await createMonth(2074, 2, 4);
    const groupB = await Promise.all(
      Array.from({ length: 4 }, (_, i) => makePerson("INSTRUCTOR", `Excl B ${i + 1}`))
    );
    const genB = await authed(request(app).post(`/api/months/${monthB.id}/generate-teams`));
    expect(genB.status).toBe(200);
    expect(genB.body.warnings).toEqual([]);

    const leaderIdsB = genB.body.teams.flatMap((t) => t.members.filter((m) => m.role === "LEADER").map((m) => m.personId));
    expect(leaderIdsB.sort()).toEqual(groupB.map((p) => p.id).sort());
    // Ninguno de los líderes del mes anterior se repite.
    for (const id of leaderIdsA) {
      expect(leaderIdsB).not.toContain(id);
    }

    await retire([...groupA, ...groupB]);
  });

  it("relaja la restricción de exclusión de líder anterior cuando el pool no alcanza (con warning)", async () => {
    // Mes C: exactamente teamCount instructores -> todos terminan de líder.
    const monthC = await createMonth(2075, 1, 3);
    const groupC = await Promise.all(
      Array.from({ length: 3 }, (_, i) => makePerson("INSTRUCTOR", `Relax C ${i + 1}`))
    );
    const genC = await authed(request(app).post(`/api/months/${monthC.id}/generate-teams`));
    expect(genC.status).toBe(200);

    // Mes D: mismo pool exacto (nadie nuevo) -> preferredLeaderPool queda
    // vacío, se relaja la restricción y se avisa con warning.
    const monthD = await createMonth(2075, 2, 3);
    const genD = await authed(request(app).post(`/api/months/${monthD.id}/generate-teams`));
    expect(genD.status).toBe(200);
    expect(genD.body.warnings.some((w) => w.code === "LIDER_REPETIDO_POSIBLE")).toBe(true);

    const leaderIdsD = genD.body.teams.flatMap((t) => t.members.filter((m) => m.role === "LEADER").map((m) => m.personId));
    expect(leaderIdsD.sort()).toEqual(groupC.map((p) => p.id).sort());

    await retire(groupC);
  });

  it("re-sortear reemplaza por completo el sorteo anterior", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 2 }, (_, i) => makePerson("INSTRUCTOR", `Resorteo Instr ${i + 1}`))
    );
    const month = await createMonth(2076, 1, 2);

    const first = await authed(request(app).post(`/api/months/${month.id}/generate-teams`));
    expect(first.status).toBe(200);
    const firstTeamIds = first.body.teams.map((t) => t.id).sort();

    const second = await authed(request(app).post(`/api/months/${month.id}/generate-teams`));
    expect(second.status).toBe(200);
    const secondTeamIds = second.body.teams.map((t) => t.id).sort();

    // Los equipos se recrean desde cero: nuevos ids, mismo tamaño, sin acumular.
    expect(secondTeamIds).not.toEqual(firstTeamIds);
    expect(second.body.teams).toHaveLength(2);

    const listed = await authed(request(app).get(`/api/months/${month.id}/teams`));
    expect(listed.status).toBe(200);
    expect(listed.body.teams).toHaveLength(2);

    await retire(instructors);
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).post("/api/months/no-existe-este-id/generate-teams"));
    expect(res.status).toBe(404);
  });

  it("409 MES_FINALIZADO si el mes ya no está DRAFT", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 1 }, (_, i) => makePerson("INSTRUCTOR", `Finalizado Instr ${i + 1}`))
    );
    const month = await createMonth(2077, 1, 1);
    await prisma.monthCycle.update({ where: { id: month.id }, data: { status: "FINALIZED" } });

    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_FINALIZADO");

    await retire(instructors);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).post("/api/months/cualquier-id/generate-teams");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/months/:id/generate-teams — equipo de jóvenes (youthTeam)", () => {
  it("youthTeam ausente: no se crea ningún equipo YOUTH ese mes, comportamiento regular intacto", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 2 }, (_, i) => makePerson("INSTRUCTOR", `Youth Ausente Instr ${i + 1}`))
    );
    const month = await createMonth(2090, 1, 2);
    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`));

    expect(res.status).toBe(200);
    expect(res.body.teams).toHaveLength(2);
    expect(res.body.teams.every((t) => t.teamType === "REGULAR")).toBe(true);

    await retire(instructors);
  });

  it("youthTeam.enabled: false explícito: tampoco se crea equipo YOUTH", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 1 }, (_, i) => makePerson("INSTRUCTOR", `Youth False Instr ${i + 1}`))
    );
    const month = await createMonth(2090, 2, 1);
    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`)).send({
      youthTeam: { enabled: false },
    });

    expect(res.status).toBe(200);
    expect(res.body.teams).toHaveLength(1);
    expect(res.body.teams.every((t) => t.teamType === "REGULAR")).toBe(true);

    await retire(instructors);
  });

  it("crea el equipo YOUTH con el líder correcto y size-1 colaboradores, ningún SUPPORT", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 1 }, (_, i) => makePerson("INSTRUCTOR", `Youth Ok Instr ${i + 1}`))
    );
    const leader = await makePerson("MINISTRO", "Youth Ok Leader", { isJoven: true });
    const jovenes = await Promise.all(
      Array.from({ length: 5 }, (_, i) => makePerson("MINISTRO", `Youth Ok Colab ${i + 1}`, { isJoven: true }))
    );

    const month = await createMonth(2090, 3, 1);
    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`)).send({
      youthTeam: { enabled: true, size: 4, leaderPersonId: leader.id },
    });

    expect(res.status).toBe(200);
    const youthTeam = res.body.teams.find((t) => t.teamType === "YOUTH");
    expect(youthTeam).toBeDefined();
    expect(youthTeam.label).toBe("Servicio de jóvenes");

    const leaders = youthTeam.members.filter((m) => m.role === "LEADER");
    const collaborators = youthTeam.members.filter((m) => m.role === "COLLABORATOR");
    const support = youthTeam.members.filter((m) => m.role === "SUPPORT");
    expect(leaders).toHaveLength(1);
    expect(leaders[0].personId).toBe(leader.id);
    expect(leaders[0].manualOverride).toBe(true);
    expect(collaborators).toHaveLength(3); // size 4 - 1 líder
    expect(support).toHaveLength(0);
    expect(collaborators.every((m) => m.manualOverride === false)).toBe(true);

    await retire([...instructors, leader, ...jovenes]);
  });

  it("falta leaderPersonId con enabled: true -> 400", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 1 }, (_, i) => makePerson("INSTRUCTOR", `Youth SinLider Instr ${i + 1}`))
    );
    const month = await createMonth(2090, 4, 1);
    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`)).send({
      youthTeam: { enabled: true, size: 3 },
    });

    expect(res.status).toBe(400);

    await retire(instructors);
  });

  it("leaderPersonId de alguien isJoven: false -> 400 LIDER_JOVENES_INVALIDO", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 1 }, (_, i) => makePerson("INSTRUCTOR", `Youth LiderNoJoven Instr ${i + 1}`))
    );
    const notJoven = await makePerson("MINISTRO", "Youth Lider No Joven", { isJoven: false });

    const month = await createMonth(2090, 5, 1);
    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`)).send({
      youthTeam: { enabled: true, size: 1, leaderPersonId: notJoven.id },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("LIDER_JOVENES_INVALIDO");

    await retire([...instructors, notJoven]);
  });

  it("leaderPersonId de alguien inactivo -> 400 LIDER_JOVENES_INVALIDO", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 1 }, (_, i) => makePerson("INSTRUCTOR", `Youth LiderInactivo Instr ${i + 1}`))
    );
    const inactiveJoven = await makePerson("MINISTRO", "Youth Lider Inactivo", { isJoven: true });
    await retire([inactiveJoven]);

    const month = await createMonth(2090, 6, 1);
    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`)).send({
      youthTeam: { enabled: true, size: 1, leaderPersonId: inactiveJoven.id },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("LIDER_JOVENES_INVALIDO");

    await retire(instructors);
  });

  it("409 POOL_JOVENES_INSUFICIENTE si hay menos personas isJoven activas que size", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 1 }, (_, i) => makePerson("INSTRUCTOR", `Youth PoolInsuf Instr ${i + 1}`))
    );
    const leader = await makePerson("MINISTRO", "Youth PoolInsuf Leader", { isJoven: true });
    const oneCollab = await makePerson("MINISTRO", "Youth PoolInsuf Colab", { isJoven: true });

    const month = await createMonth(2090, 7, 1);
    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`)).send({
      youthTeam: { enabled: true, size: 5, leaderPersonId: leader.id },
    });

    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("POOL_JOVENES_INSUFICIENTE");
    expect(res.body.error.details.available).toBe(2); // líder + 1 colaborador disponible
    expect(res.body.error.details.needed).toBe(5);

    await retire([...instructors, leader, oneCollab]);
  });

  it("prioriza a quienes no estuvieron en YOUTH el mes anterior, y relaja con warning JOVENES_REPETIDOS_POSIBLE cuando no alcanza", async () => {
    const instructorsE = await Promise.all(
      Array.from({ length: 1 }, (_, i) => makePerson("INSTRUCTOR", `Youth Relax E Instr ${i + 1}`))
    );
    const leaderE = await makePerson("MINISTRO", "Youth Relax E Leader", { isJoven: true });
    const collabsE = await Promise.all(
      Array.from({ length: 2 }, (_, i) => makePerson("MINISTRO", `Youth Relax E Colab ${i + 1}`, { isJoven: true }))
    );

    const monthE = await createMonth(2091, 1, 1);
    const genE = await authed(request(app).post(`/api/months/${monthE.id}/generate-teams`)).send({
      youthTeam: { enabled: true, size: 3, leaderPersonId: leaderE.id },
    });
    expect(genE.status).toBe(200);
    expect(genE.body.warnings.some((w) => w.code === "JOVENES_REPETIDOS_POSIBLE")).toBe(false);
    const youthTeamE = genE.body.teams.find((t) => t.teamType === "YOUTH");
    const collabIdsE = youthTeamE.members.filter((m) => m.role === "COLLABORATOR").map((m) => m.personId);
    expect(collabIdsE.sort()).toEqual(collabsE.map((p) => p.id).sort());

    // Mes F: mismo líder + mismo pool exacto (nadie nuevo) -> el pool
    // "preferido" (sin los colaboradores del mes anterior) queda vacío, se
    // relaja la restricción y se avisa con warning.
    const monthF = await createMonth(2091, 2, 1);
    const genF = await authed(request(app).post(`/api/months/${monthF.id}/generate-teams`)).send({
      youthTeam: { enabled: true, size: 3, leaderPersonId: leaderE.id },
    });
    expect(genF.status).toBe(200);
    expect(genF.body.warnings.some((w) => w.code === "JOVENES_REPETIDOS_POSIBLE")).toBe(true);
    const youthTeamF = genF.body.teams.find((t) => t.teamType === "YOUTH");
    const collabIdsF = youthTeamF.members.filter((m) => m.role === "COLLABORATOR").map((m) => m.personId);
    expect(collabIdsF.sort()).toEqual(collabsE.map((p) => p.id).sort());

    await retire([...instructorsE, leaderE, ...collabsE]);
  });

  it("una persona puede estar en su equipo REGULAR y en el equipo YOUTH el mismo mes (el índice único parcial lo permite)", async () => {
    // Único instructor activo del pool -> se convierte, sin ambigüedad, en
    // el líder del único equipo regular. Es también isJoven, y se lo
    // nombra a mano líder del equipo de jóvenes: debe terminar en AMBOS
    // equipos del mismo mes sin chocar contra ningún índice único.
    const overlapPerson = await makePerson("INSTRUCTOR", "Youth Overlap", { isJoven: true });

    const month = await createMonth(2090, 8, 1);
    const res = await authed(request(app).post(`/api/months/${month.id}/generate-teams`)).send({
      youthTeam: { enabled: true, size: 1, leaderPersonId: overlapPerson.id },
    });

    expect(res.status).toBe(200);
    const regularTeam = res.body.teams.find((t) => t.teamType === "REGULAR");
    const youthTeam = res.body.teams.find((t) => t.teamType === "YOUTH");
    expect(regularTeam.members.map((m) => m.personId)).toContain(overlapPerson.id);
    expect(youthTeam.members.map((m) => m.personId)).toContain(overlapPerson.id);

    await retire([overlapPerson]);
  });

  it("PATCH a un equipo YOUTH con role SUPPORT en el body -> rechazado con 400 ROL_INVALIDO_EQUIPO_JOVENES", async () => {
    const instructors = await Promise.all(
      Array.from({ length: 1 }, (_, i) => makePerson("INSTRUCTOR", `Youth PatchSupport Instr ${i + 1}`))
    );
    const leader = await makePerson("MINISTRO", "Youth PatchSupport Leader", { isJoven: true });
    const collab = await makePerson("MINISTRO", "Youth PatchSupport Colab", { isJoven: true });

    const month = await createMonth(2090, 9, 1);
    const gen = await authed(request(app).post(`/api/months/${month.id}/generate-teams`)).send({
      youthTeam: { enabled: true, size: 2, leaderPersonId: leader.id },
    });
    expect(gen.status).toBe(200);
    const youthTeam = gen.body.teams.find((t) => t.teamType === "YOUTH");

    const res = await authed(request(app).patch(`/api/teams/${youthTeam.id}`)).send({
      members: [
        { personId: leader.id, role: "LEADER" },
        { personId: collab.id, role: "SUPPORT" },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("ROL_INVALIDO_EQUIPO_JOVENES");

    await retire([...instructors, leader, collab]);
  });
});

describe("GET /api/months/:id/teams", () => {
  it("devuelve teams: [] si todavía no se sorteó (no es error)", async () => {
    const month = await createMonth(2078, 1, 2);
    const res = await authed(request(app).get(`/api/months/${month.id}/teams`));
    expect(res.status).toBe(200);
    expect(res.body.teams).toEqual([]);
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).get("/api/months/no-existe-este-id/teams"));
    expect(res.status).toBe(404);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).get("/api/months/cualquier-id/teams");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/teams/:teamId", () => {
  async function setupTwoTeamMonth(yearMonthPair) {
    const [year, month] = yearMonthPair;
    const leaderA = await makePerson("INSTRUCTOR", "Patch Leader A");
    const leaderB = await makePerson("INSTRUCTOR", "Patch Leader B");
    const collabA = await makePerson("MINISTRO", "Patch Collab A");
    const collabB = await makePerson("MINISTRO", "Patch Collab B");

    const monthCycle = await createMonth(year, month, 2);
    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`));
    expect(gen.status).toBe(200);

    const [teamX, teamY] = gen.body.teams;
    return { monthCycle, teamX, teamY, leaderA, leaderB, collabA, collabB };
  }

  it("mueve una persona de un equipo a otro", async () => {
    const { monthCycle, teamX, teamY, leaderA, leaderB, collabA, collabB } = await setupTwoTeamMonth([2079, 1]);

    // Determinar cuál colaborador quedó en cuál equipo tras el sorteo.
    const teamXCollabIds = teamX.members.filter((m) => m.role === "COLLABORATOR").map((m) => m.personId);
    const movingCollab = teamXCollabIds.includes(collabA.id) ? collabA : collabB;
    const teamYLeaderId = teamY.members.find((m) => m.role === "LEADER").personId;

    const res = await authed(request(app).patch(`/api/teams/${teamY.id}`)).send({
      members: [
        { personId: teamYLeaderId, role: "LEADER" },
        { personId: movingCollab.id, role: "COLLABORATOR" },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.team.members.map((m) => m.personId)).toContain(movingCollab.id);

    const refreshed = await authed(request(app).get(`/api/months/${monthCycle.id}/teams`));
    expect(refreshed.status).toBe(200);
    const refreshedTeamX = refreshed.body.teams.find((t) => t.id === teamX.id);
    const refreshedTeamY = refreshed.body.teams.find((t) => t.id === teamY.id);
    expect(refreshedTeamX.members.map((m) => m.personId)).not.toContain(movingCollab.id);
    expect(refreshedTeamY.members.map((m) => m.personId)).toContain(movingCollab.id);

    await retire([leaderA, leaderB, collabA, collabB]);
  });

  it("swap de líder dentro del mismo equipo (promover al que va de LEADER antes que degradar al anterior no debe romper el índice único parcial)", async () => {
    // Regresión: team_member_one_leader_per_team es un índice único parcial
    // (team_id WHERE role = 'LEADER') a nivel de base. Si el body llega con
    // el ascenso a LEADER ANTES que la baja del líder anterior, procesarlo
    // en ese mismo orden deja, por un instante, dos filas LEADER en el
    // mismo equipo y Postgres rechaza el UPDATE con P2002.
    const instructor1 = await makePerson("INSTRUCTOR", "Swap Instructor 1");
    const instructor2 = await makePerson("INSTRUCTOR", "Swap Instructor 2");

    const monthCycle = await createMonth(2079, 6, 1);
    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`));
    expect(gen.status).toBe(200);

    const [team] = gen.body.teams;
    const currentLeader = team.members.find((m) => m.role === "LEADER");
    const currentSupport = team.members.find((m) => m.role === "SUPPORT");
    expect(currentLeader).toBeDefined();
    expect(currentSupport).toBeDefined();

    // A propósito: el ascenso (nuevo LEADER) va PRIMERO en el array, la baja
    // va SEGUNDA — es el orden que reproduce el bug si el service no lo
    // corrige internamente.
    const res = await authed(request(app).patch(`/api/teams/${team.id}`)).send({
      members: [
        { personId: currentSupport.personId, role: "LEADER" },
        { personId: currentLeader.personId, role: "SUPPORT" },
      ],
    });

    expect(res.status).toBe(200);
    const roles = Object.fromEntries(res.body.team.members.map((m) => [m.personId, m.role]));
    expect(roles[currentSupport.personId]).toBe("LEADER");
    expect(roles[currentLeader.personId]).toBe("SUPPORT");

    await retire([instructor1, instructor2]);
  });

  it("PATCH con 0 líderes falla con 400 EQUIPO_SIN_LIDER", async () => {
    const { teamX, leaderA, leaderB, collabA, collabB } = await setupTwoTeamMonth([2079, 2]);
    const teamXCollabIds = teamX.members.filter((m) => m.role === "COLLABORATOR").map((m) => m.personId);
    const someCollabId = teamXCollabIds[0] ?? collabA.id;

    const res = await authed(request(app).patch(`/api/teams/${teamX.id}`)).send({
      members: [{ personId: someCollabId, role: "COLLABORATOR" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("EQUIPO_SIN_LIDER");

    await retire([leaderA, leaderB, collabA, collabB]);
  });

  it("PATCH con 2+ líderes falla con 400 EQUIPO_MULTIPLES_LIDERES", async () => {
    const { teamX, leaderA, leaderB, collabA, collabB } = await setupTwoTeamMonth([2079, 3]);
    const teamXLeaderId = teamX.members.find((m) => m.role === "LEADER").personId;
    const otherLeader = teamXLeaderId === leaderA.id ? leaderB : leaderA;

    const res = await authed(request(app).patch(`/api/teams/${teamX.id}`)).send({
      members: [
        { personId: teamXLeaderId, role: "LEADER" },
        { personId: otherLeader.id, role: "LEADER" },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("EQUIPO_MULTIPLES_LIDERES");

    await retire([leaderA, leaderB, collabA, collabB]);
  });

  it("PERSONA_NO_VALIDA si personId no existe o está inactivo", async () => {
    const { teamX, leaderA, leaderB, collabA, collabB } = await setupTwoTeamMonth([2079, 4]);
    const teamXLeaderId = teamX.members.find((m) => m.role === "LEADER").personId;

    const res = await authed(request(app).patch(`/api/teams/${teamX.id}`)).send({
      members: [
        { personId: teamXLeaderId, role: "LEADER" },
        { personId: "no-existe-esta-persona", role: "COLLABORATOR" },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("PERSONA_NO_VALIDA");

    await retire([leaderA, leaderB, collabA, collabB]);
  });

  it("404 EQUIPO_NO_ENCONTRADO si teamId no existe", async () => {
    const res = await authed(request(app).patch("/api/teams/no-existe-este-equipo")).send({ members: [] });
    expect(res.status).toBe(404);
    expect(res.body.error.details?.code).toBe("EQUIPO_NO_ENCONTRADO");
  });

  it("409 MES_FINALIZADO si el mes del equipo ya no está DRAFT", async () => {
    const { monthCycle, teamX, leaderA, leaderB, collabA, collabB } = await setupTwoTeamMonth([2079, 5]);
    await prisma.monthCycle.update({ where: { id: monthCycle.id }, data: { status: "FINALIZED" } });

    const teamXLeaderId = teamX.members.find((m) => m.role === "LEADER").personId;
    const res = await authed(request(app).patch(`/api/teams/${teamX.id}`)).send({
      members: [{ personId: teamXLeaderId, role: "LEADER" }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_FINALIZADO");

    await retire([leaderA, leaderB, collabA, collabB]);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).patch("/api/teams/cualquier-id").send({ members: [] });
    expect(res.status).toBe(401);
  });
});
