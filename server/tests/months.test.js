// GET/POST /api/months, GET /api/months/:id, DELETE /api/months/:id.
// Contrato completo en docs/architecture/phase3-teams-contract.md. Golpea la
// base Postgres real de desarrollo (igual que people.crud.test.js); todo lo
// creado se limpia en afterAll vía borrado físico directo con Prisma.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// Parte 3 (wise-noodling-hickey.md) rompió la premisa de usar un año futuro
// ficticio (2099) para las lecturas públicas: GET /schedule/:year/:month
// ahora exige isNextMonthEarlyRevealed para cualquier mes estrictamente
// futuro. Faltear Date globalmente (vi.useFakeTimers) rompería la
// verificación JWT de requireAuth (jsonwebtoken usa Date.now() real) -- en
// cambio se mockea SOLO currentCivilDate (utils/dates.js), la única función
// de este archivo que lee el reloj real. Por defecto delega a la
// implementación real. Mismo patrón que tests/publicSchedule.test.js.
const { currentCivilDateMock, setRealCurrentCivilDate, delegateToReal } = vi.hoisted(() => {
  let real = null;
  const delegateToReal = (...args) => real(...args);
  return {
    currentCivilDateMock: vi.fn(delegateToReal),
    setRealCurrentCivilDate: (fn) => {
      real = fn;
    },
    delegateToReal,
  };
});

vi.mock("../src/utils/dates.js", async (importOriginal) => {
  const actual = await importOriginal();
  setRealCurrentCivilDate(actual.currentCivilDate);
  return { ...actual, currentCivilDate: currentCivilDateMock };
});

import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

// Años lejanos y poco usuales para minimizar la chance de colisionar con
// datos reales del entorno de desarrollo o con otros archivos de test.
const YEAR_A = 2071;
const YEAR_B = 2072;

// DELETE /api/months/:id: 2099 (futuro ficticio, mismo patrón que
// phase4c-post-publish-edits.test.js) para "actual o futuro", 2019 (pasado
// real, muy anterior a la existencia de esta app) para "ya pasó".
const NAME_PREFIX = "QA MONTHS DELETE";
const RUN_ID = Date.now().toString().slice(-6);
const DOC_PREFIX = `QAMD${RUN_ID}`;
let docCounter = 0;

let token;
const createdMonthCycleIds = [];
const createdPersonIds = [];
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

async function makePerson(category, suffix) {
  docCounter += 1;
  const person = await prisma.person.create({
    data: { fullName: `${NAME_PREFIX} ${suffix}`, documentId: `${DOC_PREFIX}${docCounter}`, category, active: true },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function setupMonthWithSchedule(year, month, teamCount) {
  await Promise.all(
    Array.from({ length: teamCount + 1 }, (_, i) => makePerson("INSTRUCTOR", `${year}-${month} Instr ${i + 1}`))
  );
  await Promise.all(
    Array.from({ length: teamCount * 2 }, (_, i) => makePerson("MINISTRO", `${year}-${month} Min ${i + 1}`))
  );

  const created = await authed(request(app).post("/api/months")).send({ year, month, teamCount });
  expect(created.status).toBe(201);
  createdMonthCycleIds.push(created.body.id);

  const gen = await authed(request(app).post(`/api/months/${created.body.id}/generate-teams`));
  expect(gen.status).toBe(200);

  const sched = await authed(request(app).post(`/api/months/${created.body.id}/generate-schedule`));
  expect(sched.status).toBe(200);

  return created.body;
}

async function finalizeDirectly(monthCycleId) {
  await prisma.monthCycle.update({ where: { id: monthCycleId }, data: { status: "FINALIZED", finalizedAt: new Date() } });
}

async function expectCascadeGone(monthCycleId) {
  const [teamCount, slotCount] = await Promise.all([
    prisma.team.count({ where: { monthCycleId } }),
    prisma.serviceSlot.count({ where: { monthCycleId } }),
  ]);
  expect(teamCount).toBe(0);
  expect(slotCount).toBe(0);
}

describe("POST /api/months", () => {
  it("crea un mes nuevo (201) en estado DRAFT", async () => {
    const res = await authed(request(app).post("/api/months")).send({ year: YEAR_A, month: 1, teamCount: 4 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ year: YEAR_A, month: 1, teamCount: 4, status: "DRAFT", finalizedAt: null });
    expect(res.body.id).toBeTruthy();
    createdMonthCycleIds.push(res.body.id);
  });

  it("409 MES_YA_EXISTE si ya hay un mes para ese (year, month)", async () => {
    const res = await authed(request(app).post("/api/months")).send({ year: YEAR_A, month: 1, teamCount: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_YA_EXISTE");
    expect(res.body.error.details.monthCycleId).toBeTruthy();
  });

  it("carrera: dos POST concurrentes con el mismo (year, month) no deben producir un 409 genérico sin `details.code` (el check previo no está serializado)", async () => {
    const year = YEAR_A;
    const month = 11;
    const [resA, resB] = await Promise.all([
      authed(request(app).post("/api/months")).send({ year, month, teamCount: 2 }),
      authed(request(app).post("/api/months")).send({ year, month, teamCount: 3 }),
    ]);

    const results = [resA, resB];
    const created = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);

    expect(created.length).toBe(1);
    expect(conflicted.length).toBe(1);
    expect(conflicted[0].body.error.details?.code).toBe("MES_YA_EXISTE");
    expect(conflicted[0].body.error.details?.monthCycleId).toBe(created[0].body.id);

    createdMonthCycleIds.push(created[0].body.id);
  });

  it("400 con year fuera de rango", async () => {
    const res = await authed(request(app).post("/api/months")).send({ year: 1999, month: 1, teamCount: 2 });
    expect(res.status).toBe(400);
  });

  it("400 con month fuera de rango", async () => {
    const res = await authed(request(app).post("/api/months")).send({ year: YEAR_A, month: 13, teamCount: 2 });
    expect(res.status).toBe(400);
  });

  it("400 con teamCount fuera de rango", async () => {
    const res = await authed(request(app).post("/api/months")).send({ year: YEAR_A, month: 2, teamCount: 0 });
    expect(res.status).toBe(400);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).post("/api/months").send({ year: YEAR_A, month: 3, teamCount: 2 });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/months", () => {
  it("lista los meses ordenados por year desc, month desc", async () => {
    const early = await authed(request(app).post("/api/months")).send({ year: YEAR_B, month: 1, teamCount: 1 });
    const late = await authed(request(app).post("/api/months")).send({ year: YEAR_B, month: 6, teamCount: 1 });
    createdMonthCycleIds.push(early.body.id, late.body.id);

    const res = await authed(request(app).get("/api/months"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    const ids = res.body.data.map((m) => m.id);
    expect(ids.indexOf(late.body.id)).toBeLessThan(ids.indexOf(early.body.id));

    const yearAIndex = ids.indexOf(early.body.id);
    const yearBLaterMonthCheck = res.body.data.find((m) => m.id === late.body.id);
    expect(yearBLaterMonthCheck.year).toBe(YEAR_B);
    expect(yearAIndex).toBeGreaterThan(-1);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).get("/api/months");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/months/:id", () => {
  it("devuelve el mes (200)", async () => {
    const created = await authed(request(app).post("/api/months")).send({ year: YEAR_A, month: 4, teamCount: 3 });
    createdMonthCycleIds.push(created.body.id);

    const res = await authed(request(app).get(`/api/months/${created.body.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, year: YEAR_A, month: 4, teamCount: 3, status: "DRAFT" });
  });

  it("404 si no existe", async () => {
    const res = await authed(request(app).get("/api/months/no-existe-este-id"));
    expect(res.status).toBe(404);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).get("/api/months/cualquier-id");
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/months/:id", () => {
  it("200 borra un mes DRAFT con equipos y horario ya generados (cascada real)", async () => {
    const monthCycle = await setupMonthWithSchedule(YEAR_A, 5, 2);

    const res = await authed(request(app).delete(`/api/months/${monthCycle.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });

    await expectCascadeGone(monthCycle.id);
    const getRes = await authed(request(app).get(`/api/months/${monthCycle.id}`));
    expect(getRes.status).toBe(404);
  });

  it("200 borra un mes FINALIZED actual o futuro y lo saca de la página pública", async () => {
    const monthCycle = await setupMonthWithSchedule(2099, 5, 2);
    await finalizeDirectly(monthCycle.id);

    // Parte 3 (wise-noodling-hickey.md): GET /schedule/:year/:month ahora
    // exige que un mes ESTRICTAMENTE futuro pase isNextMonthEarlyRevealed --
    // 2099 es décadas en el futuro respecto al reloj real, así que sin fijar
    // "hoy" dentro del mismo mes (haciéndolo el mes ACTUAL, no futuro) la
    // llamada pública de abajo daría 404 en vez de 200 (ver boilerplate al
    // inicio del archivo).
    currentCivilDateMock.mockReturnValue({ year: 2099, month: 5, day: 15 });
    try {
      const publicBefore = await request(app).get(`/api/schedule/${monthCycle.year}/${monthCycle.month}`);
      expect(publicBefore.status).toBe(200);

      const res = await authed(request(app).delete(`/api/months/${monthCycle.id}`));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });

      await expectCascadeGone(monthCycle.id);
      const getRes = await authed(request(app).get(`/api/months/${monthCycle.id}`));
      expect(getRes.status).toBe(404);

      const publicAfter = await request(app).get(`/api/schedule/${monthCycle.year}/${monthCycle.month}`);
      expect(publicAfter.status).toBe(404);
    } finally {
      currentCivilDateMock.mockImplementation(delegateToReal);
    }
  });

  it("409 MES_PASADO si el mes FINALIZED ya pasó -- no se borra", async () => {
    const monthCycle = await setupMonthWithSchedule(2019, 5, 2);
    await finalizeDirectly(monthCycle.id);

    const res = await authed(request(app).delete(`/api/months/${monthCycle.id}`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_PASADO");

    const getRes = await authed(request(app).get(`/api/months/${monthCycle.id}`));
    expect(getRes.status).toBe(200);
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).delete("/api/months/no-existe-este-id"));
    expect(res.status).toBe(404);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).delete("/api/months/cualquier-id");
    expect(res.status).toBe(401);
  });
});
