// Verifica que el rate limiting del login efectivamente bloquee después del
// umbral configurado (loginLimiter: max 10 intentos / 15 min por IP, ver
// src/middleware/rateLimit.js). Vive en su propio archivo para que el
// contador del limiter (estado en memoria, por proceso) no se contamine con
// los intentos de auth.test.js — Vitest aísla el grafo de módulos por
// archivo de test, así que este archivo arranca con un contador limpio.

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/auth/login — rate limiting", () => {
  it("bloquea con 429 después de superar el máximo de intentos por IP", async () => {
    const attempts = [];
    // El límite configurado es 10 por 15 minutos; disparamos 12 para
    // garantizar que se cruza el umbral incluso si algún request intermedio
    // se pierde por timing.
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "admin", password: `intento-incorrecto-${i}` });
      attempts.push(res.status);
    }

    expect(attempts).toContain(429);

    const firstBlockedIndex = attempts.findIndex((status) => status === 429);
    // Los primeros intentos (dentro del cupo) deben ser 401 (credenciales
    // incorrectas), no 429 — el bloqueo debe aparecer solo después del umbral.
    expect(firstBlockedIndex).toBeGreaterThanOrEqual(10);
    expect(attempts.slice(0, 10)).not.toContain(429);
  });
});
