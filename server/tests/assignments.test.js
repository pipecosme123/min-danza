// PATCH /api/assignments/:id (lock/unlock, reasignar equipo a mano).
// Contrato completo en docs/architecture/phase4-schedule-contract.md §6.
// Golpea la base Postgres real de desarrollo (mismo patrón que
// teamGeneration.test.js).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA ASSIGN";
const DOC_PREFIX = `QAAS${RUN_ID}`;
let docCounter = 0;

let token;
const createdPersonIds = [];
const createdMonthCycleIds = [];
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

async function createMonth(year, month, teamCount) {
  const res = await authed(request(app).post("/api/months")).send({ year, month, teamCount });
  expect(res.status).toBe(201);
  createdMonthCycleIds.push(res.body.id);
  return res.body;
}

async function setupMonthWithSchedule({ year, month, teamCount, youthTeam }) {
  await Promise.all(Array.from({ length: teamCount + 1 }, (_, i) => makePerson("INSTRUCTOR", `${year}-${month} Instr ${i + 1}`)));
  await Promise.all(Array.from({ length: teamCount * 2 }, (_, i) => makePerson("MINISTRO", `${year}-${month} Min ${i + 1}`)));

  const monthCycle = await createMonth(year, month, teamCount);
  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`)).send(youthTeam ? { youthTeam } : {});
  expect(gen.status).toBe(200);

  const sched = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
  expect(sched.status).toBe(200);

  return { monthCycle, teams: gen.body.teams, slots: sched.body.slots };
}

function findSingleTeamFixedSlot(slots) {
  return slots.find((s) => s.slotType === "FIXED" && s.teams.length === 1);
}

describe("PATCH /api/assignments/:id", () => {
  it("bloquea (locked: true) sin cambiar el equipo", async () => {
    const { slots } = await setupMonthWithSchedule({ year: 2096, month: 1, teamCount: 2 });
    const slot = findSingleTeamFixedSlot(slots);
    const assignmentId = slot.teams[0].assignmentId;
    const originalTeamId = slot.teams[0].id;

    const res = await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({ locked: true });
    expect(res.status).toBe(200);
    expect(res.body.assignment).toMatchObject({ id: assignmentId, teamId: originalTeamId, locked: true });
  });

  it("desbloquea (locked: false)", async () => {
    const { slots } = await setupMonthWithSchedule({ year: 2096, month: 2, teamCount: 2 });
    const slot = findSingleTeamFixedSlot(slots);
    const assignmentId = slot.teams[0].assignmentId;

    await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({ locked: true });
    const res = await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({ locked: false });
    expect(res.status).toBe(200);
    expect(res.body.assignment.locked).toBe(false);
  });

  it("reasignar equipo fuerza locked: true, incluso sin mandarlo explícito", async () => {
    const { slots, teams } = await setupMonthWithSchedule({ year: 2096, month: 3, teamCount: 3 });
    const slot = findSingleTeamFixedSlot(slots);
    const assignmentId = slot.teams[0].assignmentId;
    const currentTeamId = slot.teams[0].id;
    const otherTeam = teams.find((t) => t.teamType === "REGULAR" && t.id !== currentTeamId);

    const res = await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({ teamId: otherTeam.id });
    expect(res.status).toBe(200);
    expect(res.body.assignment).toMatchObject({ id: assignmentId, teamId: otherTeam.id, locked: true });
  });

  it("400 ASIGNACION_JOVENES_NO_EDITABLE al intentar cambiar el equipo de la asignación YOUTH_SERVICE", async () => {
    const leader = await makePerson("MINISTRO", "Youth Assign Leader", { isJoven: true });
    const collab = await makePerson("MINISTRO", "Youth Assign Colab", { isJoven: true });

    const { slots, teams } = await setupMonthWithSchedule({
      year: 2096,
      month: 4,
      teamCount: 2,
      youthTeam: { enabled: true, size: 2, leaderPersonId: leader.id },
    });

    const youthSlot = slots.find((s) => s.slotType === "YOUTH_SERVICE");
    const youthAssignmentId = youthSlot.teams[0].assignmentId;
    const regularTeam = teams.find((t) => t.teamType === "REGULAR");

    const res = await authed(request(app).patch(`/api/assignments/${youthAssignmentId}`)).send({ teamId: regularTeam.id });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("ASIGNACION_JOVENES_NO_EDITABLE");

    // locked sí se puede tocar en la asignación de jóvenes (sin efecto práctico).
    const lockRes = await authed(request(app).patch(`/api/assignments/${youthAssignmentId}`)).send({ locked: true });
    expect(lockRes.status).toBe(200);

    await prisma.person.updateMany({ where: { id: { in: [leader.id, collab.id] } }, data: { active: false } });
  });

  it("400 EQUIPO_NO_VALIDO si el equipo no es del mismo mes", async () => {
    const setupA = await setupMonthWithSchedule({ year: 2096, month: 5, teamCount: 1 });
    const setupB = await setupMonthWithSchedule({ year: 2096, month: 6, teamCount: 1 });

    const slotA = findSingleTeamFixedSlot(setupA.slots);
    const assignmentId = slotA.teams[0].assignmentId;
    const foreignTeamId = setupB.teams[0].id;

    const res = await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({ teamId: foreignTeamId });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("EQUIPO_NO_VALIDO");
  });

  it("400 EQUIPO_NO_VALIDO si el equipo no es REGULAR (es YOUTH)", async () => {
    const leader = await makePerson("MINISTRO", "Youth Invalid Leader", { isJoven: true });
    const collab = await makePerson("MINISTRO", "Youth Invalid Colab", { isJoven: true });

    const { slots, teams } = await setupMonthWithSchedule({
      year: 2096,
      month: 7,
      teamCount: 2,
      youthTeam: { enabled: true, size: 2, leaderPersonId: leader.id },
    });

    const fixedSlot = findSingleTeamFixedSlot(slots);
    const assignmentId = fixedSlot.teams[0].assignmentId;
    const youthTeam = teams.find((t) => t.teamType === "YOUTH");

    const res = await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({ teamId: youthTeam.id });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("EQUIPO_NO_VALIDO");

    await prisma.person.updateMany({ where: { id: { in: [leader.id, collab.id] } }, data: { active: false } });
  });

  it("404 ASIGNACION_NO_ENCONTRADA si el id no existe", async () => {
    const res = await authed(request(app).patch("/api/assignments/no-existe-esta-asignacion")).send({ locked: true });
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("ASIGNACION_NO_ENCONTRADA");
  });

  it("409 MES_FINALIZADO si el mes de la asignación ya no está DRAFT", async () => {
    const { monthCycle, slots } = await setupMonthWithSchedule({ year: 2096, month: 8, teamCount: 1 });
    const slot = findSingleTeamFixedSlot(slots);
    const assignmentId = slot.teams[0].assignmentId;

    await prisma.monthCycle.update({ where: { id: monthCycle.id }, data: { status: "FINALIZED" } });

    const res = await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({ locked: true });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_FINALIZADO");
  });

  it("400 si el body no manda ni locked ni teamId", async () => {
    const { slots } = await setupMonthWithSchedule({ year: 2096, month: 9, teamCount: 1 });
    const slot = findSingleTeamFixedSlot(slots);
    const assignmentId = slot.teams[0].assignmentId;

    const res = await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({});
    expect(res.status).toBe(400);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).patch("/api/assignments/cualquier-id").send({ locked: true });
    expect(res.status).toBe(401);
  });
});
