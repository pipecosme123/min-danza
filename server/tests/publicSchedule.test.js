// GET /api/schedule/latest, GET /api/schedule/:year/:month — endpoints
// PÚBLICOS (sin auth). Contrato completo en
// docs/architecture/phase5-public-page-contract.md §2-§3. Golpea la base
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

const NAME_PREFIX = "QA PUBSCHED";
const RUN_ID = Date.now().toString().slice(-6);
const DOC_PREFIX = `QAPUB${RUN_ID}`;
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

/** Crea instructores/ministros suficientes, sortea equipos y genera horario. */
async function setupMonthWithSchedule({ year, month, teamCount, instructors = teamCount + 1, ministros = teamCount * 2 }) {
  await Promise.all(Array.from({ length: instructors }, () => makePerson("INSTRUCTOR")));
  await Promise.all(Array.from({ length: ministros }, () => makePerson("MINISTRO")));

  const monthCycle = await createMonth(year, month, teamCount);
  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`)).send({});
  expect(gen.status).toBe(200);

  const sched = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
  expect(sched.status).toBe(200);

  return monthCycle;
}

async function finalize(monthCycleId) {
  const res = await authed(request(app).post(`/api/months/${monthCycleId}/finalize`));
  expect(res.status).toBe(200);
  return res.body;
}

describe("GET /api/schedule/latest", () => {
  it("404 MES_NO_PUBLICADO cuando no hay ningún mes finalizado", async () => {
    // Aísla temporalmente cualquier mes FINALIZED preexistente en la base de
    // desarrollo (mismo criterio que aislar personas activas arriba): esta
    // prueba necesita que, durante su ejecución, no exista NINGÚN mes
    // FINALIZED en toda la tabla.
    const existingFinalized = await prisma.monthCycle.findMany({
      where: { status: "FINALIZED" },
      select: { id: true },
    });
    if (existingFinalized.length > 0) {
      await prisma.monthCycle.updateMany({
        where: { id: { in: existingFinalized.map((m) => m.id) } },
        data: { status: "DRAFT" },
      });
    }

    try {
      const res = await request(app).get("/api/schedule/latest");
      expect(res.status).toBe(404);
      expect(res.body.error.details.code).toBe("MES_NO_PUBLICADO");
    } finally {
      if (existingFinalized.length > 0) {
        await prisma.monthCycle.updateMany({
          where: { id: { in: existingFinalized.map((m) => m.id) } },
          data: { status: "FINALIZED" },
        });
      }
    }
  });

  it("devuelve el mes finalizado más reciente cuando hay varios, con shape month/teams/slots y sin balance", async () => {
    const older = await setupMonthWithSchedule({ year: 2082, month: 1, teamCount: 2 });
    const newer = await setupMonthWithSchedule({ year: 2082, month: 6, teamCount: 2 });

    await finalize(older.id);
    await finalize(newer.id);

    const res = await request(app).get("/api/schedule/latest");
    expect(res.status).toBe(200);
    expect(res.body.month).toMatchObject({ year: 2082, month: 6 });
    expect(res.body.month.finalizedAt).toBeTruthy();
    expect(Array.isArray(res.body.teams)).toBe(true);
    expect(res.body.teams.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.slots)).toBe(true);
    expect(res.body.slots.length).toBeGreaterThan(0);
    expect(res.body.balance).toBeUndefined();

    // Shape de teams[]: label, orderIndex, teamType, members[].
    const team = res.body.teams[0];
    expect(team).toHaveProperty("label");
    expect(team).toHaveProperty("orderIndex");
    expect(team).toHaveProperty("teamType");
    expect(Array.isArray(team.members)).toBe(true);

    // Shape de slots[]: date, startTime, slotType, title, teamsNeeded, uniform, teams[].
    const slot = res.body.slots[0];
    expect(slot).toHaveProperty("date");
    expect(slot).toHaveProperty("startTime");
    expect(slot).toHaveProperty("slotType");
    expect(slot).toHaveProperty("title");
    expect(slot).toHaveProperty("teamsNeeded");
    expect(slot).toHaveProperty("uniform");
    expect(Array.isArray(slot.teams)).toBe(true);
  });

  it("responde igual en llamadas consecutivas (caché)", async () => {
    const first = await request(app).get("/api/schedule/latest");
    const second = await request(app).get("/api/schedule/latest");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("no requiere Authorization", async () => {
    const res = await request(app).get("/api/schedule/latest");
    expect(res.status).not.toBe(401);
  });
});

describe("GET /api/schedule/:year/:month", () => {
  it("200 para un mes finalizado real", async () => {
    const monthCycle = await setupMonthWithSchedule({ year: 2083, month: 2, teamCount: 1 });
    await finalize(monthCycle.id);

    const res = await request(app).get("/api/schedule/2083/2");
    expect(res.status).toBe(200);
    expect(res.body.month).toMatchObject({ year: 2083, month: 2 });
    expect(res.body.balance).toBeUndefined();
  });

  it("404 MES_NO_PUBLICADO para un mes que no existe", async () => {
    const res = await request(app).get("/api/schedule/2083/9");
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("MES_NO_PUBLICADO");
  });

  it("404 MES_NO_PUBLICADO (mismo código) para un mes que existe pero sigue DRAFT — indistinguible de 'no existe'", async () => {
    const draftMonth = await createMonth(2083, 3, 1);

    const draftRes = await request(app).get(`/api/schedule/2083/3`);
    const missingRes = await request(app).get("/api/schedule/2083/10");

    expect(draftRes.status).toBe(404);
    expect(missingRes.status).toBe(404);
    expect(draftRes.body.error.details.code).toBe("MES_NO_PUBLICADO");
    expect(missingRes.body.error.details.code).toBe("MES_NO_PUBLICADO");
    expect(draftRes.body.error.message).toBe(missingRes.body.error.message);
    expect(draftRes.body).toEqual(missingRes.body);
    // La respuesta no debe filtrar el id del mes DRAFT en ningún lado.
    expect(JSON.stringify(draftRes.body)).not.toContain(draftMonth.id);
  });

  it("400 con year/month fuera de rango o no numéricos", async () => {
    const outOfRangeYear = await request(app).get("/api/schedule/1999/1");
    expect(outOfRangeYear.status).toBe(400);

    const outOfRangeMonth = await request(app).get("/api/schedule/2083/13");
    expect(outOfRangeMonth.status).toBe(400);

    const nonNumeric = await request(app).get("/api/schedule/abcd/xy");
    expect(nonNumeric.status).toBe(400);
  });

  it("responde igual en llamadas consecutivas (caché)", async () => {
    const first = await request(app).get("/api/schedule/2083/2");
    const second = await request(app).get("/api/schedule/2083/2");
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("no requiere Authorization", async () => {
    const res = await request(app).get("/api/schedule/2083/2");
    expect(res.status).not.toBe(401);
  });
});
