// Verifica que el rate limiting genérico de rutas administrativas
// (`adminLimiter`: max 300 intentos / 1 minuto por IP, ver
// src/middleware/rateLimit.js) efectivamente bloquee después del umbral
// configurado — hallazgo de auditoría QA Fase 7: antes de esto, un JWT
// filtrado no tenía ningún freno en /api/people, /api/months, /api/teams,
// /api/events, /api/assignments, /api/slots ni /api/uniforms.
//
// Vive en su propio archivo por la misma razón que loginRateLimit.test.js:
// el contador del limiter (estado en memoria, por proceso) no debe
// contaminarse con las requests administrativas de otros archivos de test —
// Vitest aísla el grafo de módulos por archivo de test, así que este
// archivo arranca con un contador limpio.
//
// Se ejercita contra GET /api/uniforms (lectura liviana, sin efectos
// secundarios que limpiar) para no dejar basura en la base con 300+ requests.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

// Debe coincidir con adminLimiter.max en src/middleware/rateLimit.js.
const ADMIN_LIMITER_MAX = 300;

let token;

beforeAll(async () => {
  const res = await request(app).post("/api/auth/login").send({ username: REAL_USERNAME, password: REAL_PASSWORD });
  token = res.body.token;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Rutas administrativas — rate limiting genérico (adminLimiter)", () => {
  it(
    "bloquea con 429 después de superar el máximo de requests por IP en rutas protegidas por requireAuth",
    async () => {
      const attempts = [];
      // Disparamos algunas requests de más sobre el máximo configurado para
      // garantizar que se cruza el umbral incluso si algún request
      // intermedio se pierde por timing.
      const totalRequests = ADMIN_LIMITER_MAX + 5;
      for (let i = 0; i < totalRequests; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app).get("/api/uniforms").set("Authorization", `Bearer ${token}`);
        attempts.push(res.status);
      }

      expect(attempts).toContain(429);

      const firstBlockedIndex = attempts.findIndex((status) => status === 429);
      // Los primeros requests (dentro del cupo) deben ser 200 (autenticados
      // y válidos), no 429 — el bloqueo debe aparecer solo después del umbral.
      expect(firstBlockedIndex).toBeGreaterThanOrEqual(ADMIN_LIMITER_MAX);
      expect(attempts.slice(0, ADMIN_LIMITER_MAX)).not.toContain(429);
    },
    60000
  );
});
