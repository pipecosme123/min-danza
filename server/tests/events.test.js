// POST /api/months/:id/events, PATCH /api/events/:eventId,
// DELETE /api/events/:eventId (eventos extraordinarios). Contrato completo
// en docs/architecture/phase4-schedule-contract.md §4-5, ampliado por
// docs/architecture/phase4b-schedule-refinements-contract.md §5.1 (editar en
// vez de eliminar+recrear). Golpea la base Postgres real de desarrollo
// (mismo patrón que teamGeneration.test.js).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA EVENTS";
const DOC_PREFIX = `QAEV${RUN_ID}`;
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
    data: { name: `${NAME_PREFIX} Uniforme ${suffix} ${RUN_ID}`, colorHex: "#556677" },
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

  return { monthCycle, teams: gen.body.teams, slots: sched.body.slots };
}

function midMonthDate(monthCycle) {
  return `${monthCycle.year}-${String(monthCycle.month).padStart(2, "0")}-10`;
}

describe("POST /api/months/:id/events", () => {
  it("crea un evento extraordinario con teamsNeeded: 1 y recalcula el balance", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2095, month: 1, teamCount: 2 });

    const before = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const totalBefore = before.body.balance.reduce((sum, b) => sum + b.count, 0);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA Vigilia",
      teamsNeeded: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.slot).toMatchObject({
      slotType: "EXTRAORDINARY",
      title: "QA Vigilia",
      teamsNeeded: 1,
      countsTowardBalance: true,
    });
    expect(res.body.slot.teams).toHaveLength(1);

    const after = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const totalAfter = after.body.balance.reduce((sum, b) => sum + b.count, 0);
    expect(totalAfter).toBe(totalBefore + 1);
  });

  it("crea un evento extraordinario con teamsNeeded: 2 y asigna 2 equipos distintos", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2095, month: 2, teamCount: 3 });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "20:00",
      title: "QA Congreso",
      teamsNeeded: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.slot.teamsNeeded).toBe(2);
    expect(res.body.slot.teams).toHaveLength(2);
    expect(res.body.slot.teams[0].id).not.toBe(res.body.slot.teams[1].id);
  });

  it("400 FECHA_FUERA_DE_MES si la fecha no cae en el año/mes del ciclo", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2095, month: 3, teamCount: 1 });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: "2095-04-15",
      startTime: "19:00",
      title: "QA Fecha Fuera",
      teamsNeeded: 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("FECHA_FUERA_DE_MES");
  });

  it("409 HORARIO_NO_GENERADO si el mes todavía no tiene ServiceSlot", async () => {
    await Promise.all([makePerson("INSTRUCTOR", "SinHorario Instr 1"), makePerson("INSTRUCTOR", "SinHorario Instr 2")]);
    const monthCycle = await createMonth(2095, 4, 1);
    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`));
    expect(gen.status).toBe(200);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA Sin Horario",
      teamsNeeded: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("HORARIO_NO_GENERADO");
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).post("/api/months/no-existe-este-id/events")).send({
      date: "2095-01-10",
      startTime: "19:00",
      title: "QA No Existe",
      teamsNeeded: 1,
    });
    expect(res.status).toBe(404);
  });

  it("409 MES_FINALIZADO si el mes ya no está DRAFT", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2095, month: 5, teamCount: 1 });
    await prisma.monthCycle.update({ where: { id: monthCycle.id }, data: { status: "FINALIZED" } });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA Finalizado",
      teamsNeeded: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_FINALIZADO");
  });

  it("400 con teamsNeeded fuera de {1,2}", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2095, month: 6, teamCount: 1 });
    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA TeamsNeeded Invalido",
      teamsNeeded: 3,
    });
    expect(res.status).toBe(400);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).post("/api/months/cualquier-id/events").send({});
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/events/:eventId", () => {
  it("edita fecha/hora/título/cantidad de equipos/uniforme de un evento existente sin borrarlo (mismo id)", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2095, month: 10, teamCount: 3 });

    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA Editar Original",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);
    const eventId = created.body.slot.id;

    const uniform = await makeUniform("Editar");
    const newDate = `${monthCycle.year}-${String(monthCycle.month).padStart(2, "0")}-15`;

    const patched = await authed(request(app).patch(`/api/events/${eventId}`)).send({
      date: newDate,
      startTime: "20:15",
      title: "QA Editar Actualizado",
      teamsNeeded: 2,
      uniformId: uniform.id,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.slot).toMatchObject({
      id: eventId,
      date: newDate,
      startTime: "20:15",
      title: "QA Editar Actualizado",
      teamsNeeded: 2,
      slotType: "EXTRAORDINARY",
    });
    expect(patched.body.slot.uniform).toMatchObject({ id: uniform.id });
    expect(patched.body.slot.teams).toHaveLength(2);

    // Limpiar el uniforme con uniformId: null.
    const cleared = await authed(request(app).patch(`/api/events/${eventId}`)).send({ uniformId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.slot.uniform).toBeNull();
    expect(cleared.body.slot.id).toBe(eventId);
  });

  it("404 EVENTO_NO_ENCONTRADO si no existe o no es EXTRAORDINARY", async () => {
    const notFound = await authed(request(app).patch("/api/events/no-existe-este-evento")).send({ title: "X" });
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.details.code).toBe("EVENTO_NO_ENCONTRADO");

    const { slots } = await setupMonthWithSchedule({ year: 2095, month: 11, teamCount: 1 });
    const fixedSlot = slots.find((s) => s.slotType === "FIXED");
    const onFixed = await authed(request(app).patch(`/api/events/${fixedSlot.id}`)).send({ title: "X" });
    expect(onFixed.status).toBe(404);
    expect(onFixed.body.error.details.code).toBe("EVENTO_NO_ENCONTRADO");
  });

  it("409 MES_FINALIZADO si el mes no está DRAFT", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2095, month: 12, teamCount: 1 });

    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA Editar Finalizado",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    await prisma.monthCycle.update({ where: { id: monthCycle.id }, data: { status: "FINALIZED" } });

    const res = await authed(request(app).patch(`/api/events/${created.body.slot.id}`)).send({ title: "X" });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_FINALIZADO");
  });

  it("400 FECHA_FUERA_DE_MES si la nueva fecha no cae en el año/mes del ciclo", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2097, month: 1, teamCount: 1 });

    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA Editar Fecha Fuera",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    const res = await authed(request(app).patch(`/api/events/${created.body.slot.id}`)).send({ date: "2097-02-15" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("FECHA_FUERA_DE_MES");
  });

  it("400 UNIFORME_NO_VALIDO si el uniformId indicado no existe o no está activo", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2097, month: 2, teamCount: 1 });

    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA Editar Uniforme Invalido",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    const res = await authed(request(app).patch(`/api/events/${created.body.slot.id}`)).send({ uniformId: "no-existe" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("UNIFORME_NO_VALIDO");
  });

  it("409 EQUIPOS_BLOQUEADOS_EXCEDEN_CUPO al intentar bajar teamsNeeded por debajo de asignaciones locked existentes", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2097, month: 3, teamCount: 3 });

    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA Editar Cupo Bloqueado",
      teamsNeeded: 2,
    });
    expect(created.status).toBe(201);
    expect(created.body.slot.teams).toHaveLength(2);

    // Bloquear las 2 asignaciones existentes.
    for (const team of created.body.slot.teams) {
      const lockRes = await authed(request(app).patch(`/api/assignments/${team.assignmentId}`)).send({ locked: true });
      expect(lockRes.status).toBe(200);
    }

    const res = await authed(request(app).patch(`/api/events/${created.body.slot.id}`)).send({ teamsNeeded: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("EQUIPOS_BLOQUEADOS_EXCEDEN_CUPO");
    expect(res.body.error.details.locked).toBe(2);
    expect(res.body.error.details.teamsNeeded).toBe(1);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).patch("/api/events/cualquier-id").send({ title: "X" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/events/:eventId", () => {
  it("borra el evento y recalcula el balance", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2095, month: 7, teamCount: 2 });

    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA Borrar",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    const before = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const totalBefore = before.body.balance.reduce((sum, b) => sum + b.count, 0);

    const res = await authed(request(app).delete(`/api/events/${created.body.slot.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });

    const after = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const totalAfter = after.body.balance.reduce((sum, b) => sum + b.count, 0);
    expect(totalAfter).toBe(totalBefore - 1);

    const stillListed = after.body.slots.some((s) => s.id === created.body.slot.id);
    expect(stillListed).toBe(false);
  });

  it("404 EVENTO_NO_ENCONTRADO si el id no existe", async () => {
    const res = await authed(request(app).delete("/api/events/no-existe-este-evento"));
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("EVENTO_NO_ENCONTRADO");
  });

  it("404 EVENTO_NO_ENCONTRADO al intentar borrar un slot FIXED", async () => {
    const { slots } = await setupMonthWithSchedule({ year: 2095, month: 8, teamCount: 1 });
    const fixedSlot = slots.find((s) => s.slotType === "FIXED");

    const res = await authed(request(app).delete(`/api/events/${fixedSlot.id}`));
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("EVENTO_NO_ENCONTRADO");
  });

  it("404 EVENTO_NO_ENCONTRADO al intentar borrar el slot YOUTH_SERVICE", async () => {
    const leader = await makePerson("MINISTRO", "Youth Delete Leader");
    await prisma.person.update({ where: { id: leader.id }, data: { isJoven: true } });
    const collab = await makePerson("MINISTRO", "Youth Delete Colab");
    await prisma.person.update({ where: { id: collab.id }, data: { isJoven: true } });

    await Promise.all([makePerson("INSTRUCTOR", "Youth Delete Instr 1")]);
    const monthCycle = await createMonth(2095, 9, 1);
    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`)).send({
      youthTeam: { enabled: true, size: 2, leaderPersonId: leader.id },
    });
    expect(gen.status).toBe(200);
    const sched = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(sched.status).toBe(200);

    const youthSlot = sched.body.slots.find((s) => s.slotType === "YOUTH_SERVICE");
    expect(youthSlot).toBeDefined();

    const res = await authed(request(app).delete(`/api/events/${youthSlot.id}`));
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("EVENTO_NO_ENCONTRADO");
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).delete("/api/events/cualquier-id");
    expect(res.status).toBe(401);
  });
});
