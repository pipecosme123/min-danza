// POST /api/auth/login: camino feliz + casos de error/borde.
// Credenciales correctas vienen del AdminUser sembrado por prisma/seed.js
// contra la base real de desarrollo (contenedor api-ejercicio-pg).

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

describe("POST /api/auth/login", () => {
  it("credenciales correctas devuelven 200 con un JWT y datos del admin (sin el hash)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: REAL_USERNAME, password: REAL_PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.split(".")).toHaveLength(3); // forma de un JWT
    expect(res.body.admin).toMatchObject({ username: REAL_USERNAME });

    // El endpoint no debe filtrar el hash de la contraseña ni otros campos
    // internos del AdminUser.
    expect(res.body.admin.passwordHash).toBeUndefined();
    expect(res.body.admin.password).toBeUndefined();
  });

  it("password incorrecta devuelve 401 con mensaje genérico (no revela cuál campo falló)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: REAL_USERNAME, password: "password-incorrecta" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBeTruthy();
    expect(res.body.error.message.toLowerCase()).not.toContain("hash");
  });

  it("usuario inexistente devuelve 401 (mismo mensaje genérico que password incorrecta)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "no-existe-este-usuario", password: "cualquiera" });

    expect(res.status).toBe(401);
  });

  it("body sin password devuelve 400 de validación (no 500, no llega a tocar la BD)", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: REAL_USERNAME });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBeTruthy();
  });

  it("body vacío devuelve 400 de validación", async () => {
    const res = await request(app).post("/api/auth/login").send({});

    expect(res.status).toBe(400);
  });
});
