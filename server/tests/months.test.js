// GET/POST /api/months, GET /api/months/:id. Contrato completo en
// docs/architecture/phase3-teams-contract.md. Golpea la base Postgres real
// de desarrollo (igual que people.crud.test.js); todo lo creado se limpia en
// afterAll vía borrado físico directo con Prisma.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

// Años lejanos y poco usuales para minimizar la chance de colisionar con
// datos reales del entorno de desarrollo o con otros archivos de test.
const YEAR_A = 2071;
const YEAR_B = 2072;

let token;
const createdMonthCycleIds = [];

beforeAll(async () => {
  const res = await request(app).post("/api/auth/login").send({ username: REAL_USERNAME, password: REAL_PASSWORD });
  token = res.body.token;
});

afterAll(async () => {
  await prisma.monthCycle.deleteMany({ where: { id: { in: createdMonthCycleIds } } });
  await prisma.$disconnect();
});

function authed(req) {
  return req.set("Authorization", `Bearer ${token}`);
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
