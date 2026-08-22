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
import { currentCivilDate } from "../src/utils/dates.js";
import { env } from "../src/config/env.js";

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
const createdUniformIds = [];
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
  await prisma.uniform.deleteMany({ where: { id: { in: createdUniformIds } } });

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

// Ventana de historial de 1 año (ajustado 2026-08-22): a diferencia del
// resto de este archivo, NO se puede usar un año ficticio lejano (2083...)
// para evitar colisiones -- el corte depende de la fecha civil REAL de hoy
// (currentCivilDate), así que los meses de prueba que necesiten caer DENTRO
// de la ventana se calculan relativos a ella, con la misma función que usa
// la implementación real.
function monthsAgo(n) {
  const today = currentCivilDate(env.APP_TIMEZONE);
  const totalMonths = today.year * 12 + (today.month - 1) - n;
  return { year: Math.floor(totalMonths / 12), month: (totalMonths % 12) + 1 };
}

/**
 * Ajustado 2026-08-22: finalizeMonthCycle ahora exige que ningún turno quede
 * sin uniforme asignado (TURNOS_SIN_UNIFORME) -- esta suite no prueba esa
 * regla (la prueba finalize.test.js), así que asigna un uniforme "de
 * relleno" a todos los slots del mes por prisma directo, antes de finalizar.
 */
async function finalize(monthCycleId) {
  const uniform = await prisma.uniform.create({
    data: { name: `${NAME_PREFIX} Uniforme Relleno ${Date.now()}`, colorHex: "#334455" },
  });
  createdUniformIds.push(uniform.id);
  await prisma.serviceSlot.updateMany({ where: { monthCycleId }, data: { uniformId: uniform.id } });

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
    // Aísla cualquier FINALIZED preexistente (mismo criterio que el test de
    // arriba): "más reciente" debe resolverse SOLO entre los dos meses
    // sintéticos de este test. Ya no vale usar un año ficticio futuro
    // (2082...) para garantizar quién "gana" -- /latest ahora nunca elige un
    // mes posterior a hoy (ver el test dedicado más abajo), así que ambos
    // fixtures tienen que ser meses PASADOS reales (monthsAgo).
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
      const olderTarget = monthsAgo(10);
      const newerTarget = monthsAgo(4);
      const older = await setupMonthWithSchedule({ year: olderTarget.year, month: olderTarget.month, teamCount: 2 });
      const newer = await setupMonthWithSchedule({ year: newerTarget.year, month: newerTarget.month, teamCount: 2 });

      await finalize(older.id);
      await finalize(newer.id);

      const res = await request(app).get("/api/schedule/latest");
      expect(res.status).toBe(200);
      expect(res.body.month).toMatchObject({ year: newerTarget.year, month: newerTarget.month });
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
    } finally {
      if (existingFinalized.length > 0) {
        await prisma.monthCycle.updateMany({
          where: { id: { in: existingFinalized.map((m) => m.id) } },
          data: { status: "FINALIZED" },
        });
      }
    }
  });

  it("NUNCA elige un mes futuro ya finalizado por anticipado: prefiere el más reciente hacia atrás (ajustado 2026-08-22)", async () => {
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
      const pastTarget = monthsAgo(2);
      const futureTarget = monthsAgo(-3); // 3 meses en el futuro respecto a hoy.
      const past = await setupMonthWithSchedule({ year: pastTarget.year, month: pastTarget.month, teamCount: 1 });
      const future = await setupMonthWithSchedule({ year: futureTarget.year, month: futureTarget.month, teamCount: 1 });

      await finalize(past.id);
      await finalize(future.id);

      const res = await request(app).get("/api/schedule/latest");
      expect(res.status).toBe(200);
      // Aunque el mes futuro es "más reciente" en términos de (year, month),
      // /latest debe devolver el pasado -- nunca adelantarse a hoy.
      expect(res.body.month).toMatchObject({ year: pastTarget.year, month: pastTarget.month });
    } finally {
      if (existingFinalized.length > 0) {
        await prisma.monthCycle.updateMany({
          where: { id: { in: existingFinalized.map((m) => m.id) } },
          data: { status: "FINALIZED" },
        });
      }
    }
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

describe("GET /api/schedule/history y ventana de 1 año", () => {
  it("un mes FINALIZED a exactamente 12 meses de hoy es visible; a 13 meses queda fuera de la ventana (mismo 404 genérico)", async () => {
    const within12 = monthsAgo(12);
    const beyond13 = monthsAgo(13);

    const monthWithin = await createMonth(within12.year, within12.month, 1);
    await prisma.monthCycle.update({ where: { id: monthWithin.id }, data: { status: "FINALIZED" } });

    const monthBeyond = await createMonth(beyond13.year, beyond13.month, 1);
    await prisma.monthCycle.update({ where: { id: monthBeyond.id }, data: { status: "FINALIZED" } });

    const resWithin = await request(app).get(`/api/schedule/${within12.year}/${within12.month}`);
    expect(resWithin.status).toBe(200);
    expect(resWithin.body.month).toMatchObject({ year: within12.year, month: within12.month });

    const resBeyond = await request(app).get(`/api/schedule/${beyond13.year}/${beyond13.month}`);
    expect(resBeyond.status).toBe(404);
    expect(resBeyond.body.error.details.code).toBe("MES_NO_PUBLICADO");

    const history = await request(app).get("/api/schedule/history");
    expect(history.status).toBe(200);
    expect(history.body.months).toContainEqual({ year: within12.year, month: within12.month });
    expect(history.body.months).not.toContainEqual({ year: beyond13.year, month: beyond13.month });
  });

  it("un mes DRAFT dentro de la ventana de 1 año no aparece en el historial ni es accesible", async () => {
    const draftTarget = monthsAgo(3);
    await createMonth(draftTarget.year, draftTarget.month, 1); // nace DRAFT, nunca se finaliza

    const res = await request(app).get(`/api/schedule/${draftTarget.year}/${draftTarget.month}`);
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("MES_NO_PUBLICADO");

    const history = await request(app).get("/api/schedule/history");
    expect(history.body.months).not.toContainEqual({ year: draftTarget.year, month: draftTarget.month });
  });

  it("GET /api/schedule/history no requiere Authorization y ordena year desc, month desc", async () => {
    const res = await request(app).get("/api/schedule/history");
    expect(res.status).not.toBe(401);
    const months = res.body.months;
    for (let i = 1; i < months.length; i += 1) {
      const prev = months[i - 1];
      const curr = months[i];
      const prevIndex = prev.year * 12 + prev.month;
      const currIndex = curr.year * 12 + curr.month;
      expect(prevIndex).toBeGreaterThanOrEqual(currIndex);
    }
  });
});
