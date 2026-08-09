// Prueba de regresión explícita para el bug ya corregido en esta sesión:
// el middleware de auth se aplicaba de forma GLOBAL y ese filtro se colaba
// hacia el endpoint público de horario, exigiéndole JWT por error.
//
// Ahora cada router administrativo aplica `requireAuth` individualmente
// (ver src/routes/*.routes.js) y schedule.routes.js queda deliberadamente
// sin auth. Estas pruebas fijan ese contrato para que no se vuelva a romper.

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Endpoints administrativos exigen JWT válido", () => {
  it("GET /api/people sin token devuelve 401", async () => {
    const res = await request(app).get("/api/people");
    expect(res.status).toBe(401);
  });

  it("GET /api/people con token malformado (sin 'Bearer ') devuelve 401", async () => {
    const res = await request(app).get("/api/people").set("Authorization", "esto-no-es-un-bearer-token");
    expect(res.status).toBe(401);
  });

  it("GET /api/people con token inválido/corrupto devuelve 401", async () => {
    const res = await request(app).get("/api/people").set("Authorization", "Bearer token.invalido.corrupto");
    expect(res.status).toBe(401);
  });

  it("GET /api/people con token expirado devuelve 401", async () => {
    const expiredToken = jwt.sign({ sub: "fake-admin-id", username: "admin" }, env.JWT_SECRET, {
      expiresIn: "-10s", // ya vencido al firmarlo
    });
    const res = await request(app).get("/api/people").set("Authorization", `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it("GET /api/people con token válido pasa el auth guard (responde 200, no 401)", async () => {
    const validToken = jwt.sign({ sub: "fake-admin-id", username: "admin" }, env.JWT_SECRET, {
      expiresIn: "5m",
    });
    const res = await request(app).get("/api/people").set("Authorization", `Bearer ${validToken}`);
    // Fase 2: GET /api/people ya está implementado (antes respondía 501).
    // Lo que nos importa verificar es que NO es 401: el guard reconoció el token.
    expect(res.status).toBe(200);
  });

  // Cubre el resto de routers administrativos con el mismo patrón, para
  // detectar si alguno queda desprotegido por accidente en el futuro.
  it.each([
    ["GET", "/api/months"],
    ["GET", "/api/uniforms"],
    ["POST", "/api/uniforms"],
    ["PATCH", "/api/uniforms/algun-id"],
    ["GET", "/api/uniforms/weekday-config"],
    ["PATCH", "/api/uniforms/weekday-config/WEDNESDAY"],
    ["GET", "/api/uniforms/youth-service-config"],
    ["PATCH", "/api/uniforms/youth-service-config"],
    ["PATCH", "/api/assignments/algun-id"],
    // teams/events se montan en "/" (no en su propio prefijo) y aplican
    // requireAuth por ruta individual en vez de router.use(requireAuth) —
    // justo el patrón que casi se rompió antes. Ver comentarios en
    // teams.routes.js / events.routes.js.
    ["POST", "/api/months/algun-id/generate-teams"],
    ["GET", "/api/months/algun-id/teams"],
    ["PATCH", "/api/teams/algun-id"],
    ["POST", "/api/months/algun-id/generate-schedule"],
    ["GET", "/api/months/algun-id/schedule"],
    ["POST", "/api/months/algun-id/events"],
    ["DELETE", "/api/events/algun-id"],
  ])("%s %s sin token devuelve 401", async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/schedule/:year/:month es público (regresión del bug de auth global)", () => {
  it("responde SIN exigir token (401 nunca debe aparecer aquí)", async () => {
    const res = await request(app).get("/api/schedule/2026/8");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("responde con el shape público real (200 si el mes está publicado, 404 MES_NO_PUBLICADO si no) — nunca 501 (Fase 5 ya implementada)", async () => {
    const res = await request(app).get("/api/schedule/2026/8");
    expect(res.status).not.toBe(501);
    expect([200, 404]).toContain(res.status);
    if (res.status === 404) {
      expect(res.body.error.details.code).toBe("MES_NO_PUBLICADO");
    }
  });

  it("sigue siendo público incluso con un token corrupto/basura en el header", async () => {
    const res = await request(app)
      .get("/api/schedule/2026/8")
      .set("Authorization", "Bearer esto-es-basura");
    expect(res.status).not.toBe(401);
  });
});
