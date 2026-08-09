// POST /api/months/:id/finalize. Contrato completo en
// docs/architecture/phase5-public-page-contract.md §1. Golpea la base
// Postgres real de desarrollo (mismo patrón que scheduleGeneration.test.js):
// el pool de sorteo de generate-teams es GLOBAL a toda persona activa, así
// que este archivo también aísla temporalmente a cualquier INSTRUCTOR/
// MINISTRO activo preexistente.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const NAME_PREFIX = "QA FINALIZE";
const RUN_ID = Date.now().toString().slice(-6);
const DOC_PREFIX = `QAFIN${RUN_ID}`;
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

async function makePerson(category) {
  docCounter += 1;
  const person = await prisma.person.create({
    data: {
      fullName: `${NAME_PREFIX} ${category} ${docCounter}`,
      documentId: `${DOC_PREFIX}${docCounter}`,
      category,
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

/** Crea instructores/ministros suficientes y sortea equipos. */
async function setupMonthWithTeams({ year, month, teamCount, instructors = teamCount + 1, ministros = teamCount * 2 }) {
  await Promise.all(Array.from({ length: instructors }, () => makePerson("INSTRUCTOR")));
  await Promise.all(Array.from({ length: ministros }, () => makePerson("MINISTRO")));

  const monthCycle = await createMonth(year, month, teamCount);
  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`)).send({});
  expect(gen.status).toBe(200);

  return monthCycle;
}

describe("POST /api/months/:id/finalize", () => {
  it("200: finaliza un mes con equipos y horario -> status FINALIZED, finalizedAt no nulo", async () => {
    const monthCycle = await setupMonthWithTeams({ year: 2081, month: 1, teamCount: 2 });

    const scheduleRes = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(scheduleRes.status).toBe(200);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: monthCycle.id, status: "FINALIZED" });
    expect(res.body.finalizedAt).not.toBeNull();
  });

  it("409 MES_YA_FINALIZADO si se llama una segunda vez", async () => {
    const monthCycle = await setupMonthWithTeams({ year: 2081, month: 2, teamCount: 1 });
    const scheduleRes = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(scheduleRes.status).toBe(200);

    const first = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(first.status).toBe(200);

    const second = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(second.status).toBe(409);
    expect(second.body.error.details.code).toBe("MES_YA_FINALIZADO");
  });

  it("409 MES_INCOMPLETO si el mes no tiene equipos ni horario", async () => {
    const monthCycle = await createMonth(2081, 3, 2);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_INCOMPLETO");
    expect(res.body.error.details.hasTeams).toBe(false);
    expect(res.body.error.details.hasSchedule).toBe(false);
  });

  it("409 MES_INCOMPLETO si el mes tiene equipos pero no horario", async () => {
    const monthCycle = await setupMonthWithTeams({ year: 2081, month: 4, teamCount: 1 });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_INCOMPLETO");
    expect(res.body.error.details.hasTeams).toBe(true);
    expect(res.body.error.details.hasSchedule).toBe(false);
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).post("/api/months/no-existe-este-id/finalize"));
    expect(res.status).toBe(404);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).post("/api/months/cualquier-id/finalize");
    expect(res.status).toBe(401);
  });
});
