// POST /api/months/:id/finalize. Contrato completo en
// docs/architecture/phase5-public-page-contract.md §1. Golpea la base
// Postgres real de desarrollo (mismo patrón que scheduleGeneration.test.js):
// el pool de sorteo de generate-teams es GLOBAL a toda persona activa, así
// que este archivo también aísla temporalmente a cualquier INSTRUCTOR/
// MINISTRO activo preexistente.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const NAME_PREFIX = "QA FINALIZE";
const RUN_ID = Date.now().toString().slice(-6);
const DOC_PREFIX = `QAFIN${RUN_ID}`;
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

async function makeUniform(suffix) {
  const uniform = await prisma.uniform.create({
    data: { name: `${NAME_PREFIX} Uniforme ${suffix} ${RUN_ID}`, colorHex: "#334455" },
  });
  createdUniformIds.push(uniform.id);
  return uniform;
}

function midMonthDate(monthCycle) {
  return `${monthCycle.year}-${String(monthCycle.month).padStart(2, "0")}-10`;
}

/** Asigna un uniforme "de relleno" a TODOS los slots del mes (atajo directo por
 * prisma, no vía PATCH /api/slots/:id -- eso ya lo prueba slots.test.js). Lo
 * necesitan los tests que finalizan un mes pero no son los que prueban
 * específicamente la regla TURNOS_SIN_UNIFORME. */
async function assignUniformToAllSlots(monthCycleId, suffix) {
  const uniform = await makeUniform(suffix);
  await prisma.serviceSlot.updateMany({ where: { monthCycleId }, data: { uniformId: uniform.id } });
}

async function createMonth(year, month, teamCount) {
  const res = await authed(request(app).post("/api/months")).send({ year, month, teamCount });
  expect(res.status).toBe(201);
  createdMonthCycleIds.push(res.body.id);
  return res.body;
}

/** Crea instructores/ministros suficientes y sortea equipos. */
async function setupMonthWithTeams({ year, month, teamCount, instructors = teamCount + 1, ministros = teamCount * 2 }) {
  await Promise.all(Array.from({ length: instructors }, () => makePerson("INSTRUCTOR")));
  await Promise.all(Array.from({ length: ministros }, () => makePerson("MINISTRO")));

  const monthCycle = await createMonth(year, month, teamCount);
  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`)).send({});
  expect(gen.status).toBe(200);

  return monthCycle;
}

describe("POST /api/months/:id/finalize", () => {
  it("200: finaliza un mes con equipos y horario -> status FINALIZED, finalizedAt no nulo", async () => {
    const monthCycle = await setupMonthWithTeams({ year: 2081, month: 1, teamCount: 2 });

    const scheduleRes = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(scheduleRes.status).toBe(200);
    await assignUniformToAllSlots(monthCycle.id, "Basico");

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: monthCycle.id, status: "FINALIZED" });
    expect(res.body.finalizedAt).not.toBeNull();
  });

  it("409 MES_YA_FINALIZADO si se llama una segunda vez", async () => {
    const monthCycle = await setupMonthWithTeams({ year: 2081, month: 2, teamCount: 1 });
    const scheduleRes = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(scheduleRes.status).toBe(200);
    await assignUniformToAllSlots(monthCycle.id, "YaFinalizado");

    const first = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(first.status).toBe(200);

    const second = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(second.status).toBe(409);
    expect(second.body.error.details.code).toBe("MES_YA_FINALIZADO");
  });

  it("409 MES_INCOMPLETO si el mes no tiene equipos ni horario", async () => {
    const monthCycle = await createMonth(2081, 3, 2);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_INCOMPLETO");
    expect(res.body.error.details.hasTeams).toBe(false);
    expect(res.body.error.details.hasSchedule).toBe(false);
  });

  it("409 MES_INCOMPLETO si el mes tiene equipos pero no horario", async () => {
    const monthCycle = await setupMonthWithTeams({ year: 2081, month: 4, teamCount: 1 });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_INCOMPLETO");
    expect(res.body.error.details.hasTeams).toBe(true);
    expect(res.body.error.details.hasSchedule).toBe(false);
  });

  it("409 TURNOS_SIN_UNIFORME si algún turno no tiene uniforme asignado (ajustado 2026-08-22)", async () => {
    const monthCycle = await setupMonthWithTeams({ year: 2081, month: 5, teamCount: 1 });
    const scheduleRes = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(scheduleRes.status).toBe(200);
    // Ningún slot tiene uniforme recién generado (Fase 4b: nacen sin default).

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("TURNOS_SIN_UNIFORME");
    expect(res.body.error.details.slots.length).toBeGreaterThan(0);
    expect(res.body.error.details.slots[0]).toHaveProperty("date");
    expect(res.body.error.details.slots[0]).toHaveProperty("startTime");
    expect(res.body.error.details.slots[0]).toHaveProperty("slotType");
  });

  it("200: finaliza si todos los turnos tienen uniforme asignado", async () => {
    const monthCycle = await setupMonthWithTeams({ year: 2081, month: 6, teamCount: 1 });
    const scheduleRes = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(scheduleRes.status).toBe(200);

    const uniform = await makeUniform("Completo");
    await prisma.serviceSlot.updateMany({ where: { monthCycleId: monthCycle.id }, data: { uniformId: uniform.id } });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("FINALIZED");
  });

  it("200: un evento EXTRAORDINARY cancelado sin uniforme no bloquea la finalización", async () => {
    const monthCycle = await setupMonthWithTeams({ year: 2081, month: 7, teamCount: 1 });
    const scheduleRes = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(scheduleRes.status).toBe(200);

    // Asignar uniforme a todos los turnos ya generados (fijos + Servicio de jóvenes si lo hubiera).
    const uniform = await makeUniform("ConCancelado");
    await prisma.serviceSlot.updateMany({ where: { monthCycleId: monthCycle.id }, data: { uniformId: uniform.id } });

    // Evento extraordinario nuevo, SIN uniforme, que se cancela antes de finalizar.
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "20:00",
      title: "QA Finalize Cancelado",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);
    expect(created.body.slot.uniform).toBeNull();

    const cancelRes = await authed(request(app).post(`/api/events/${created.body.slot.id}/cancel`));
    expect(cancelRes.status).toBe(200);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/finalize`));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("FINALIZED");
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).post("/api/months/no-existe-este-id/finalize"));
    expect(res.status).toBe(404);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).post("/api/months/cualquier-id/finalize");
    expect(res.status).toBe(401);
  });
});
