// POST/GET /api/months/:id/event-groups, PATCH /api/event-groups/:groupId,
// POST /api/event-groups/:groupId/turnos, PATCH/DELETE
// /api/event-groups/turnos/:slotId, POST /api/event-groups/:groupId/cancel,
// DELETE /api/event-groups/:groupId. Eventos agrupados ("Congreso"). Contrato
// completo en el plan wise-noodling-hickey.md, Parte 2. Golpea la base
// Postgres real de desarrollo (mismo patrón que events.test.js).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA EVGROUP";
const DOC_PREFIX = `QAEG${RUN_ID}`;
let docCounter = 0;

let token;
const createdPersonIds = [];
const createdMonthCycleIds = [];
const createdUniformIds = [];
let preExistingActiveIds = [];

beforeAll(async () => {
  const res = await request(app).post("/api/auth/login").send({ username: REAL_USERNAME, password: REAL_PASSWORD });
  token = res.body.token;

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
  await prisma.slotAssignment.deleteMany({ where: { monthCycleId: { in: createdMonthCycleIds } } });
  await prisma.serviceSlot.deleteMany({ where: { monthCycleId: { in: createdMonthCycleIds } } });
  await prisma.eventGroup.deleteMany({ where: { monthCycleId: { in: createdMonthCycleIds } } });
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

  await prisma.uniform.deleteMany({ where: { id: { in: createdUniformIds } } });

  await prisma.$disconnect();
});

function authed(req) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function makePerson(category, suffix) {
  docCounter += 1;
  const person = await prisma.person.create({
    data: { fullName: `${NAME_PREFIX} ${suffix}`, documentId: `${DOC_PREFIX}${docCounter}`, category, active: true },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function createMonth(year, month, teamCount) {
  const res = await authed(request(app).post("/api/months")).send({ year, month, teamCount });
  expect(res.status).toBe(201);
  createdMonthCycleIds.push(res.body.id);
  return res.body;
}

async function makeUniform(suffix) {
  const uniform = await prisma.uniform.create({
    data: { name: `${NAME_PREFIX} Uniforme ${suffix} ${RUN_ID}`, colorHex: "#221144" },
  });
  createdUniformIds.push(uniform.id);
  return uniform;
}

async function setupMonthWithSchedule({ year, month, teamCount }) {
  await Promise.all(Array.from({ length: teamCount + 1 }, (_, i) => makePerson("INSTRUCTOR", `${year}-${month} Instr ${i + 1}`)));
  await Promise.all(Array.from({ length: teamCount * 2 }, (_, i) => makePerson("MINISTRO", `${year}-${month} Min ${i + 1}`)));

  const monthCycle = await createMonth(year, month, teamCount);
  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`));
  expect(gen.status).toBe(200);

  const sched = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
  expect(sched.status).toBe(200);

  const regularTeams = gen.body.teams.filter((t) => t.teamType === "REGULAR");
  return { monthCycle, teams: gen.body.teams, regularTeams, slots: sched.body.slots };
}

function dateInMonth(monthCycle, day) {
  return `${monthCycle.year}-${String(monthCycle.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function balanceByTeamId(monthCycleId) {
  const res = await authed(request(app).get(`/api/months/${monthCycleId}/schedule`));
  expect(res.status).toBe(200);
  return new Map(res.body.balance.map((b) => [b.teamId, b.count]));
}

describe("POST /api/months/:id/event-groups", () => {
  it("crea un Congreso con 3 fechas (una con 2 turnos) y sube el balance de cada equipo elegido", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2080, month: 1, teamCount: 3 });
    const [teamA, teamB, teamC] = regularTeams;

    const before = await balanceByTeamId(monthCycle.id);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Congreso",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "18:00", teamIds: [teamA.id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [teamA.id, teamB.id] },
        { date: dateInMonth(monthCycle, 6), startTime: "18:00", teamIds: [teamC.id] },
        { date: dateInMonth(monthCycle, 7), startTime: "10:00", teamIds: [teamB.id, teamC.id] },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.group.title).toBe("QA Congreso");
    expect(res.body.group.slots).toHaveLength(4);
    for (const slot of res.body.group.slots) {
      expect(slot.slotType).toBe("EXTRAORDINARY");
      expect(slot.countsTowardBalance).toBe(true);
      expect(slot.title).toBe("QA Congreso");
      expect(slot.eventGroup).toMatchObject({ id: res.body.group.id, title: "QA Congreso" });
      for (const t of slot.teams) {
        expect(t.locked).toBe(true);
      }
    }

    const after = await balanceByTeamId(monthCycle.id);
    // teamA participa en 2 turnos, teamB en 2, teamC en 2.
    expect(after.get(teamA.id) - before.get(teamA.id)).toBe(2);
    expect(after.get(teamB.id) - before.get(teamB.id)).toBe(2);
    expect(after.get(teamC.id) - before.get(teamC.id)).toBe(2);
  });

  it("409 HORARIO_NO_GENERADO si el mes todavía no tiene ServiceSlot", async () => {
    await Promise.all([makePerson("INSTRUCTOR", "SinHorario Instr 1"), makePerson("INSTRUCTOR", "SinHorario Instr 2")]);
    const monthCycle = await createMonth(2080, 2, 1);
    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`));
    expect(gen.status).toBe(200);
    const teamId = gen.body.teams.find((t) => t.teamType === "REGULAR").id;

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Sin Horario",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "18:00", teamIds: [teamId] },
        { date: dateInMonth(monthCycle, 6), startTime: "18:00", teamIds: [teamId] },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("HORARIO_NO_GENERADO");
  });

  it("400 CONGRESO_MINIMO_DOS_FECHAS si todos los turnos comparten la misma fecha", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2080, month: 3, teamCount: 1 });
    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Misma Fecha",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 5), startTime: "18:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("CONGRESO_MINIMO_DOS_FECHAS");
  });

  it("400 FECHA_FUERA_DE_MES si algún turno cae fuera del año/mes del ciclo", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2080, month: 4, teamCount: 1 });
    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Fecha Fuera",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: "2080-12-25", startTime: "18:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("FECHA_FUERA_DE_MES");
  });

  it("400 EQUIPO_NO_VALIDO con equipos duplicados dentro del mismo turno", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2080, month: 5, teamCount: 2 });
    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Equipo Duplicado",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id, regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[1].id] },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("EQUIPO_NO_VALIDO");
  });

  it("400 EQUIPO_NO_VALIDO con un equipo de otro mes", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2080, month: 6, teamCount: 1 });
    const other = await setupMonthWithSchedule({ year: 2080, month: 7, teamCount: 1 });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Equipo Otro Mes",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [other.regularTeams[0].id] },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("EQUIPO_NO_VALIDO");
  });

  it("400 UNIFORME_NO_VALIDO si el uniformId indicado no existe o no está activo", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2080, month: 8, teamCount: 1 });
    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Uniforme Invalido",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id], uniformId: "no-existe" },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("UNIFORME_NO_VALIDO");
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).post("/api/months/no-existe-este-id/event-groups")).send({
      title: "QA No Existe",
      turnos: [
        { date: "2080-01-05", startTime: "10:00", teamIds: ["cualquier-id"] },
        { date: "2080-01-06", startTime: "10:00", teamIds: ["cualquier-id"] },
      ],
    });
    expect(res.status).toBe(404);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).post("/api/months/cualquier-id/event-groups").send({});
    expect(res.status).toBe(401);
  });
});

describe("GET /api/months/:id/event-groups", () => {
  it("lista los grupos del mes con sus slots anidados", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2080, month: 9, teamCount: 2 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Listado",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[1].id] },
      ],
    });
    expect(created.status).toBe(201);

    const res = await authed(request(app).get(`/api/months/${monthCycle.id}/event-groups`));
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].id).toBe(created.body.group.id);
    expect(res.body.groups[0].slots).toHaveLength(2);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).get("/api/months/cualquier-id/event-groups");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/event-groups/:groupId (renombrar)", () => {
  it("renombra el grupo Y sus slots", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2080, month: 10, teamCount: 1 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Titulo Original",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(created.status).toBe(201);

    const res = await authed(request(app).patch(`/api/event-groups/${created.body.group.id}`)).send({
      title: "QA Titulo Nuevo",
    });
    expect(res.status).toBe(200);
    expect(res.body.group.title).toBe("QA Titulo Nuevo");
    expect(res.body.group.slots.every((s) => s.title === "QA Titulo Nuevo")).toBe(true);
  });

  it("404 EVENTO_AGRUPADO_NO_ENCONTRADO si el grupo no existe", async () => {
    const res = await authed(request(app).patch("/api/event-groups/no-existe")).send({ title: "X" });
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("EVENTO_AGRUPADO_NO_ENCONTRADO");
  });
});

describe("POST /api/event-groups/:groupId/turnos (agregar turno)", () => {
  it("agrega un turno más al grupo y sube el balance del equipo elegido", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2080, month: 11, teamCount: 2 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Agregar Turno",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(created.status).toBe(201);

    const before = await balanceByTeamId(monthCycle.id);

    const res = await authed(request(app).post(`/api/event-groups/${created.body.group.id}/turnos`)).send({
      date: dateInMonth(monthCycle, 7),
      startTime: "12:00",
      teamIds: [regularTeams[1].id],
    });
    expect(res.status).toBe(201);
    expect(res.body.slot.eventGroup.id).toBe(created.body.group.id);
    expect(res.body.slot.teams).toHaveLength(1);

    const after = await balanceByTeamId(monthCycle.id);
    expect(after.get(regularTeams[1].id) - before.get(regularTeams[1].id)).toBe(1);

    const list = await authed(request(app).get(`/api/months/${monthCycle.id}/event-groups`));
    expect(list.body.groups[0].slots).toHaveLength(3);
  });
});

describe("PATCH /api/event-groups/turnos/:slotId (editar turno)", () => {
  it("reemplaza el set completo de equipos de un turno (locked: true) y ajusta el balance", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2080, month: 12, teamCount: 3 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Editar Turno",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(created.status).toBe(201);
    const slotId = created.body.group.slots[0].id;

    const before = await balanceByTeamId(monthCycle.id);

    const res = await authed(request(app).patch(`/api/event-groups/turnos/${slotId}`)).send({
      teamIds: [regularTeams[1].id, regularTeams[2].id],
    });
    expect(res.status).toBe(200);
    expect(res.body.slot.teamsNeeded).toBe(2);
    expect(res.body.slot.teams).toHaveLength(2);
    expect(res.body.slot.teams.every((t) => t.locked)).toBe(true);

    const after = await balanceByTeamId(monthCycle.id);
    expect(after.get(regularTeams[0].id) - before.get(regularTeams[0].id)).toBe(-1);
    expect(after.get(regularTeams[1].id) - before.get(regularTeams[1].id)).toBe(1);
    expect(after.get(regularTeams[2].id) - before.get(regularTeams[2].id)).toBe(1);
  });

  it("404 TURNO_NO_ENCONTRADO si el slot no existe o no pertenece a ningún grupo", async () => {
    const { slots } = await setupMonthWithSchedule({ year: 2084, month: 1, teamCount: 1 });
    const fixedSlot = slots.find((s) => s.slotType === "FIXED");

    const res = await authed(request(app).patch(`/api/event-groups/turnos/${fixedSlot.id}`)).send({ startTime: "09:00" });
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("TURNO_NO_ENCONTRADO");
  });
});

describe("DELETE /api/event-groups/turnos/:slotId (borrar turno suelto)", () => {
  it("borra un turno sin borrar el grupo si quedan otros turnos", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2084, month: 2, teamCount: 1 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Borrar Turno",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 7), startTime: "10:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(created.status).toBe(201);
    const slotId = created.body.group.slots[0].id;

    const res = await authed(request(app).delete(`/api/event-groups/turnos/${slotId}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, groupDeleted: false });

    const list = await authed(request(app).get(`/api/months/${monthCycle.id}/event-groups`));
    expect(list.body.groups[0].slots).toHaveLength(2);
  });

  it("borra el grupo completo cuando se elimina el último turno restante", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2084, month: 3, teamCount: 1 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Borrar Ultimo Turno",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(created.status).toBe(201);
    const [slotA, slotB] = created.body.group.slots;

    const first = await authed(request(app).delete(`/api/event-groups/turnos/${slotA.id}`));
    expect(first.status).toBe(200);
    expect(first.body.groupDeleted).toBe(false);

    const second = await authed(request(app).delete(`/api/event-groups/turnos/${slotB.id}`));
    expect(second.status).toBe(200);
    expect(second.body.groupDeleted).toBe(true);

    const list = await authed(request(app).get(`/api/months/${monthCycle.id}/event-groups`));
    expect(list.body.groups).toHaveLength(0);
  });
});

describe("POST /api/event-groups/:groupId/cancel", () => {
  it("cancela todos los turnos activos del grupo y limpia sus asignaciones", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2084, month: 4, teamCount: 1 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Cancelar",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(created.status).toBe(201);

    const before = await balanceByTeamId(monthCycle.id);

    const res = await authed(request(app).post(`/api/event-groups/${created.body.group.id}/cancel`));
    expect(res.status).toBe(200);
    expect(res.body.group.slots.every((s) => s.cancelledAt !== null)).toBe(true);
    expect(res.body.group.slots.every((s) => s.countsTowardBalance === false)).toBe(true);
    expect(res.body.group.slots.every((s) => s.teams.length === 0)).toBe(true);

    const after = await balanceByTeamId(monthCycle.id);
    expect(after.get(regularTeams[0].id) - before.get(regularTeams[0].id)).toBe(-2);
  });

  it("409 CONGRESO_YA_CANCELADO si ya estaba cancelado", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2084, month: 5, teamCount: 1 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Doble Cancelar",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(created.status).toBe(201);

    const first = await authed(request(app).post(`/api/event-groups/${created.body.group.id}/cancel`));
    expect(first.status).toBe(200);

    const second = await authed(request(app).post(`/api/event-groups/${created.body.group.id}/cancel`));
    expect(second.status).toBe(409);
    expect(second.body.error.details.code).toBe("CONGRESO_YA_CANCELADO");
  });
});

describe("DELETE /api/event-groups/:groupId", () => {
  it("borra el grupo completo (cascada: slots y asignaciones)", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2084, month: 6, teamCount: 1 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Borrar Grupo",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(created.status).toBe(201);
    const slotIds = created.body.group.slots.map((s) => s.id);

    const res = await authed(request(app).delete(`/api/event-groups/${created.body.group.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });

    const remainingSlots = await prisma.serviceSlot.count({ where: { id: { in: slotIds } } });
    expect(remainingSlots).toBe(0);
    const remainingAssignments = await prisma.slotAssignment.count({ where: { serviceSlotId: { in: slotIds } } });
    expect(remainingAssignments).toBe(0);

    const list = await authed(request(app).get(`/api/months/${monthCycle.id}/event-groups`));
    expect(list.body.groups).toHaveLength(0);
  });

  it("404 EVENTO_AGRUPADO_NO_ENCONTRADO si el grupo no existe", async () => {
    const res = await authed(request(app).delete("/api/event-groups/no-existe"));
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("EVENTO_AGRUPADO_NO_ENCONTRADO");
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).delete("/api/event-groups/cualquier-id");
    expect(res.status).toBe(401);
  });
});

describe("Un mes FINALIZED que ya pasó bloquea las escrituras de eventos agrupados", () => {
  it("409 MES_PASADO al crear un Congreso en un mes finalizado y pasado", async () => {
    const { monthCycle, regularTeams } = await setupMonthWithSchedule({ year: 2020, month: 6, teamCount: 1 });
    await prisma.monthCycle.update({ where: { id: monthCycle.id }, data: { status: "FINALIZED" } });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/event-groups`)).send({
      title: "QA Mes Pasado",
      turnos: [
        { date: dateInMonth(monthCycle, 5), startTime: "10:00", teamIds: [regularTeams[0].id] },
        { date: dateInMonth(monthCycle, 6), startTime: "10:00", teamIds: [regularTeams[0].id] },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_PASADO");
  });
});
