// CRUD de Uniform + configuración de WeekdayUniform / YouthServiceUniform.
// Contrato completo en docs/architecture/phase4-schedule-contract.md §7.
// Golpea la base Postgres real de desarrollo.
//
// WeekdayUniform/YouthServiceUniform son config GLOBAL (no por mes), así que
// este archivo captura el estado original en beforeAll y lo restaura en
// afterAll, mismo criterio que el aislamiento del pool de personas en
// teamGeneration.test.js.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = `QA UNIFORME ${RUN_ID}`;

let token;
const createdUniformIds = [];
let originalWednesdayUniformId = null;
let originalSundayUniformId = null;
let originalYouthUniformId = null;

beforeAll(async () => {
  const res = await request(app).post("/api/auth/login").send({ username: REAL_USERNAME, password: REAL_PASSWORD });
  token = res.body.token;

  const wed = await prisma.weekdayUniform.findUnique({ where: { weekday: "WEDNESDAY" } });
  const sun = await prisma.weekdayUniform.findUnique({ where: { weekday: "SUNDAY" } });
  originalWednesdayUniformId = wed?.uniformId ?? null;
  originalSundayUniformId = sun?.uniformId ?? null;

  const youth = await prisma.youthServiceUniform.findFirst();
  originalYouthUniformId = youth?.uniformId ?? null;
});

afterAll(async () => {
  await prisma.weekdayUniform.deleteMany({ where: { weekday: { in: ["WEDNESDAY", "SUNDAY"] } } });
  if (originalWednesdayUniformId) {
    await prisma.weekdayUniform.create({ data: { weekday: "WEDNESDAY", uniformId: originalWednesdayUniformId } });
  }
  if (originalSundayUniformId) {
    await prisma.weekdayUniform.create({ data: { weekday: "SUNDAY", uniformId: originalSundayUniformId } });
  }

  await prisma.youthServiceUniform.deleteMany({});
  if (originalYouthUniformId) {
    await prisma.youthServiceUniform.create({ data: { uniformId: originalYouthUniformId } });
  }

  await prisma.uniform.deleteMany({ where: { id: { in: createdUniformIds } } });
  await prisma.uniform.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });

  await prisma.$disconnect();
});

function authed(req) {
  return req.set("Authorization", `Bearer ${token}`);
}

describe("CRUD de uniformes", () => {
  it("POST crea un uniforme (201)", async () => {
    const res = await authed(request(app).post("/api/uniforms")).send({
      name: `${NAME_PREFIX} A`,
      colorHex: "#1E40AF",
      description: "Uniforme de prueba",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: `${NAME_PREFIX} A`, colorHex: "#1E40AF", active: true });
    createdUniformIds.push(res.body.id);
  });

  it("409 UNIFORME_DUPLICADO si el nombre ya existe", async () => {
    const first = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} Dup` });
    expect(first.status).toBe(201);
    createdUniformIds.push(first.body.id);

    const res = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} Dup` });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("UNIFORME_DUPLICADO");
  });

  it("GET lista todos los uniformes (activos e inactivos)", async () => {
    const created = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} Lista` });
    expect(created.status).toBe(201);
    createdUniformIds.push(created.body.id);

    const res = await authed(request(app).get("/api/uniforms"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((u) => u.id === created.body.id)).toBe(true);
  });

  it("PATCH actualiza un uniforme parcialmente", async () => {
    const created = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} Patch` });
    expect(created.status).toBe(201);
    createdUniformIds.push(created.body.id);

    const res = await authed(request(app).patch(`/api/uniforms/${created.body.id}`)).send({
      colorHex: "#00FF00",
      active: false,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, colorHex: "#00FF00", active: false, name: `${NAME_PREFIX} Patch` });
  });

  it("PATCH con nombre duplicado devuelve 409 UNIFORME_DUPLICADO", async () => {
    const a = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} PatchDupA` });
    const b = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} PatchDupB` });
    createdUniformIds.push(a.body.id, b.body.id);

    const res = await authed(request(app).patch(`/api/uniforms/${b.body.id}`)).send({ name: `${NAME_PREFIX} PatchDupA` });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("UNIFORME_DUPLICADO");
  });

  it("PATCH 404 si el uniforme no existe", async () => {
    const res = await authed(request(app).patch("/api/uniforms/no-existe-este-uniforme")).send({ active: false });
    expect(res.status).toBe(404);
  });

  it("sin token: GET/POST/PATCH devuelven 401", async () => {
    expect((await request(app).get("/api/uniforms")).status).toBe(401);
    expect((await request(app).post("/api/uniforms").send({ name: "x" })).status).toBe(401);
    expect((await request(app).patch("/api/uniforms/cualquier-id").send({ active: false })).status).toBe(401);
  });
});

describe("Config de uniforme por día de semana", () => {
  it("PATCH /uniforms/weekday-config/WEDNESDAY hace upsert de la fila", async () => {
    const uniform = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} Miercoles` });
    createdUniformIds.push(uniform.body.id);

    const res = await authed(request(app).patch("/api/uniforms/weekday-config/WEDNESDAY")).send({
      uniformId: uniform.body.id,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ weekday: "WEDNESDAY", uniformId: uniform.body.id });

    const list = await authed(request(app).get("/api/uniforms/weekday-config"));
    expect(list.status).toBe(200);
    const wed = list.body.data.find((d) => d.weekday === "WEDNESDAY");
    expect(wed.uniformId).toBe(uniform.body.id);
  });

  it("PATCH /uniforms/weekday-config/SUNDAY hace upsert de la fila", async () => {
    const uniform = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} Domingo` });
    createdUniformIds.push(uniform.body.id);

    const res = await authed(request(app).patch("/api/uniforms/weekday-config/SUNDAY")).send({
      uniformId: uniform.body.id,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ weekday: "SUNDAY", uniformId: uniform.body.id });
  });

  it("400 para cualquier día de semana distinto de WEDNESDAY/SUNDAY", async () => {
    const uniform = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} Lunes` });
    createdUniformIds.push(uniform.body.id);

    const res = await authed(request(app).patch("/api/uniforms/weekday-config/MONDAY")).send({
      uniformId: uniform.body.id,
    });
    expect(res.status).toBe(400);
  });

  it("sin token devuelve 401", async () => {
    expect((await request(app).get("/api/uniforms/weekday-config")).status).toBe(401);
    expect((await request(app).patch("/api/uniforms/weekday-config/WEDNESDAY").send({ uniformId: "x" })).status).toBe(401);
  });
});

describe("Config del Servicio de jóvenes (singleton)", () => {
  it("GET devuelve uniformId: null si no está configurado", async () => {
    await prisma.youthServiceUniform.deleteMany({});
    const res = await authed(request(app).get("/api/uniforms/youth-service-config"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ uniformId: null });
  });

  it("PATCH hace upsert correcto en llamadas repetidas (sigue siendo una sola fila)", async () => {
    const uniformA = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} JovenesA` });
    const uniformB = await authed(request(app).post("/api/uniforms")).send({ name: `${NAME_PREFIX} JovenesB` });
    createdUniformIds.push(uniformA.body.id, uniformB.body.id);

    const first = await authed(request(app).patch("/api/uniforms/youth-service-config")).send({
      uniformId: uniformA.body.id,
    });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ uniformId: uniformA.body.id });

    const second = await authed(request(app).patch("/api/uniforms/youth-service-config")).send({
      uniformId: uniformB.body.id,
    });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ uniformId: uniformB.body.id });

    const rows = await prisma.youthServiceUniform.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].uniformId).toBe(uniformB.body.id);

    const get = await authed(request(app).get("/api/uniforms/youth-service-config"));
    expect(get.body).toEqual({ uniformId: uniformB.body.id });
  });

  it("sin token devuelve 401", async () => {
    expect((await request(app).get("/api/uniforms/youth-service-config")).status).toBe(401);
    expect((await request(app).patch("/api/uniforms/youth-service-config").send({ uniformId: "x" })).status).toBe(401);
  });
});
