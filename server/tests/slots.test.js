// PATCH /api/slots/:id — asignar/limpiar el uniforme de un ServiceSlot
// puntual (FIXED, YOUTH_SERVICE o EXTRAORDINARY). Contrato completo en
// docs/architecture/phase4b-schedule-refinements-contract.md §1.3. Golpea la
// base Postgres real de desarrollo (mismo patrón que events.test.js).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA SLOTS";
const DOC_PREFIX = `QASL${RUN_ID}`;
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

async function makeUniform(suffix) {
  const uniform = await prisma.uniform.create({
    data: { name: `${NAME_PREFIX} Uniforme ${suffix} ${RUN_ID}`, colorHex: "#334455" },
  });
  createdUniformIds.push(uniform.id);
  return uniform;
}

async function createMonth(year, month, teamCount) {
  const res = await authed(request(app).post("/api/months")).send({ year, month, teamCount });
  expect(res.status).toBe(201);
  createdMonthCycleIds.push(res.body.id);
  return res.body;
}

function midMonthDate(monthCycle) {
  return `${monthCycle.year}-${String(monthCycle.month).padStart(2, "0")}-10`;
}

async function setupMonthWithSchedule({ year, month, teamCount, youthTeam }) {
  const leader = youthTeam ? await makePerson("MINISTRO", "Youth Leader", { isJoven: true }) : null;
  if (leader && youthTeam) youthTeam.leaderPersonId = leader.id;

  await Promise.all(Array.from({ length: teamCount + 1 }, (_, i) => makePerson("INSTRUCTOR", `${year}-${month} Instr ${i + 1}`)));
  await Promise.all(Array.from({ length: teamCount * 2 }, (_, i) => makePerson("MINISTRO", `${year}-${month} Min ${i + 1}`)));
  if (youthTeam) {
    await Promise.all(
      Array.from({ length: (youthTeam.size ?? 3) - 1 }, (_, i) => makePerson("MINISTRO", `${year}-${month} Youth Colab ${i + 1}`, { isJoven: true }))
    );
  }

  const monthCycle = await createMonth(year, month, teamCount);
  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`)).send(
    youthTeam ? { youthTeam } : {}
  );
  expect(gen.status).toBe(200);

  const sched = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
  expect(sched.status).toBe(200);

  return { monthCycle, teams: gen.body.teams, slots: sched.body.slots };
}

describe("PATCH /api/slots/:id", () => {
  it("asigna y limpia el uniforme de un slot FIXED", async () => {
    const { slots } = await setupMonthWithSchedule({ year: 2096, month: 1, teamCount: 2 });
    const fixedSlot = slots.find((s) => s.slotType === "FIXED");
    expect(fixedSlot.uniform).toBeNull();

    const uniform = await makeUniform("Fixed");

    const patched = await authed(request(app).patch(`/api/slots/${fixedSlot.id}`)).send({ uniformId: uniform.id });
    expect(patched.status).toBe(200);
    expect(patched.body.slot.uniform).toMatchObject({ id: uniform.id, name: uniform.name });

    const cleared = await authed(request(app).patch(`/api/slots/${fixedSlot.id}`)).send({ uniformId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.slot.uniform).toBeNull();
  });

  it("asigna y limpia el uniforme de un slot YOUTH_SERVICE", async () => {
    const { slots } = await setupMonthWithSchedule({
      year: 2096,
      month: 2,
      teamCount: 1,
      youthTeam: { enabled: true, size: 3 },
    });
    const youthSlot = slots.find((s) => s.slotType === "YOUTH_SERVICE");
    expect(youthSlot).toBeDefined();
    expect(youthSlot.uniform).toBeNull();

    const uniform = await makeUniform("Youth");

    const patched = await authed(request(app).patch(`/api/slots/${youthSlot.id}`)).send({ uniformId: uniform.id });
    expect(patched.status).toBe(200);
    expect(patched.body.slot.uniform).toMatchObject({ id: uniform.id });

    const cleared = await authed(request(app).patch(`/api/slots/${youthSlot.id}`)).send({ uniformId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.slot.uniform).toBeNull();
  });

  it("asigna y limpia el uniforme de un slot EXTRAORDINARY", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2096, month: 3, teamCount: 2 });

    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA Slots Evento",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);
    expect(created.body.slot.uniform).toBeNull();

    const uniform = await makeUniform("Extra");

    const patched = await authed(request(app).patch(`/api/slots/${created.body.slot.id}`)).send({ uniformId: uniform.id });
    expect(patched.status).toBe(200);
    expect(patched.body.slot.uniform).toMatchObject({ id: uniform.id });

    const cleared = await authed(request(app).patch(`/api/slots/${created.body.slot.id}`)).send({ uniformId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.slot.uniform).toBeNull();
  });

  it("404 TURNO_NO_ENCONTRADO si el slot no existe", async () => {
    const res = await authed(request(app).patch("/api/slots/no-existe-este-slot")).send({ uniformId: null });
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("TURNO_NO_ENCONTRADO");
  });

  it("409 MES_FINALIZADO si el mes del turno no está DRAFT", async () => {
    const { monthCycle, slots } = await setupMonthWithSchedule({ year: 2096, month: 4, teamCount: 1 });
    await prisma.monthCycle.update({ where: { id: monthCycle.id }, data: { status: "FINALIZED" } });

    const fixedSlot = slots.find((s) => s.slotType === "FIXED");
    const res = await authed(request(app).patch(`/api/slots/${fixedSlot.id}`)).send({ uniformId: null });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_FINALIZADO");
  });

  it("400 UNIFORME_NO_VALIDO si el uniformId no existe o no está activo", async () => {
    const { slots } = await setupMonthWithSchedule({ year: 2096, month: 5, teamCount: 1 });
    const fixedSlot = slots.find((s) => s.slotType === "FIXED");

    const notFound = await authed(request(app).patch(`/api/slots/${fixedSlot.id}`)).send({ uniformId: "no-existe" });
    expect(notFound.status).toBe(400);
    expect(notFound.body.error.details.code).toBe("UNIFORME_NO_VALIDO");

    const inactive = await prisma.uniform.create({
      data: { name: `${NAME_PREFIX} Inactivo ${RUN_ID}`, active: false },
    });
    createdUniformIds.push(inactive.id);

    const res = await authed(request(app).patch(`/api/slots/${fixedSlot.id}`)).send({ uniformId: inactive.id });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("UNIFORME_NO_VALIDO");
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).patch("/api/slots/cualquier-id").send({ uniformId: null });
    expect(res.status).toBe(401);
  });
});
