// CRUD de Uniform. Contrato completo en
// docs/architecture/phase4-schedule-contract.md §7, recortado por
// docs/architecture/phase4b-schedule-refinements-contract.md §1.4: ya no hay
// configuración automática por día de semana ni para el Servicio de
// jóvenes (esos endpoints se eliminaron por completo, ver los tests de
// "endpoints eliminados" al final de este archivo). Golpea la base Postgres
// real de desarrollo.

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

beforeAll(async () => {
  const res = await request(app).post("/api/auth/login").send({ username: REAL_USERNAME, password: REAL_PASSWORD });
  token = res.body.token;
});

afterAll(async () => {
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

describe("Endpoints de configuración automática eliminados (Fase 4b §1.4)", () => {
  it("GET/PATCH /api/uniforms/weekday-config ya no existen", async () => {
    expect((await authed(request(app).get("/api/uniforms/weekday-config"))).status).toBe(404);
    expect(
      (await authed(request(app).patch("/api/uniforms/weekday-config/WEDNESDAY")).send({ uniformId: "x" })).status
    ).toBe(404);
  });

  it("GET/PATCH /api/uniforms/youth-service-config ya no existen", async () => {
    expect((await authed(request(app).get("/api/uniforms/youth-service-config"))).status).toBe(404);
    // PATCH de un solo segmento cae en la ruta genérica PATCH /:id (que trata
    // "youth-service-config" como si fuera un id de Uniform) en vez de en
    // ninguna ruta específica — sigue sin haber ningún rastro funcional del
    // endpoint viejo: { uniformId } no es un campo válido de Uniform, así
    // que zod lo descarta y el body queda vacío -> 400, nunca actualiza nada.
    const res = await authed(request(app).patch("/api/uniforms/youth-service-config")).send({ uniformId: "x" });
    expect(res.status).toBe(400);
  });
});
