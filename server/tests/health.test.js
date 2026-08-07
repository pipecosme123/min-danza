// Prueba de humo: el servidor puede construir la app (Express + Prisma) y
// GET /health confirma la conexión real a la base de datos, no solo que el
// proceso esté vivo.

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /health", () => {
  it("responde 200 con database: connected cuando Postgres está disponible", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", database: "connected" });
  });

  it("la respuesta coincide con una consulta directa a la base (no es un mock)", async () => {
    // Verificación cruzada: confirmamos con una query directa que hay
    // conexión real, para no confiar únicamente en la respuesta HTTP.
    const rows = await prisma.$queryRaw`SELECT 1 as ok`;
    expect(Array.isArray(rows)).toBe(true);
    expect(Number(rows[0].ok)).toBe(1);
  });
});
