// POST /api/months/:id/youth-team/cancel, DELETE /api/months/:id/youth-team.
// Cancelar/eliminar el Servicio de jóvenes sin re-sortear todo el mes.
// Mismo mecanismo que cancelEvent/deleteEvent (events.service.js) y mismo
// criterio de edición post-publicación (assertEditableConsideringFinalization)
// que ya usan agregar/cancelar/eliminar eventos y cambiar uniforme. Golpea la
// base Postgres real de desarrollo (mismo patrón que phase4c-post-publish-
// edits.test.js).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// Parte 3 (wise-noodling-hickey.md) rompió la premisa de usar un año futuro
// ficticio (2086/2087) para las lecturas públicas: GET /schedule/:year/:month
// ahora exige isNextMonthEarlyRevealed para cualquier mes estrictamente
// futuro. Faltear Date globalmente (vi.useFakeTimers) rompería la
// verificación JWT de requireAuth (jsonwebtoken usa Date.now() real) -- en
// cambio se mockea SOLO currentCivilDate (utils/dates.js). Por defecto
// delega a la implementación real. Mismo patrón que
// tests/publicSchedule.test.js.
const { currentCivilDateMock, setRealCurrentCivilDate, delegateToReal } = vi.hoisted(() => {
  let real = null;
  const delegateToReal = (...args) => real(...args);
  return {
    currentCivilDateMock: vi.fn(delegateToReal),
    setRealCurrentCivilDate: (fn) => {
      real = fn;
    },
    delegateToReal,
  };
});

vi.mock("../src/utils/dates.js", async (importOriginal) => {
  const actual = await importOriginal();
  setRealCurrentCivilDate(actual.currentCivilDate);
  return { ...actual, currentCivilDate: currentCivilDateMock };
});

import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA YOUTH";
const DOC_PREFIX = `QAYT${RUN_ID}`;
let docCounter = 0;

let token;
const createdPersonIds = [];
const createdMonthCycleIds = [];
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

  if (preExistingActiveIds.length > 0) {
    await prisma.person.updateMany({ where: { id: { in: preExistingActiveIds } }, data: { active: true } });
  }

  await prisma.$disconnect();
});

function authed(req) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function makePerson(category, suffix, opts = {}) {
  docCounter += 1;
  const person = await prisma.person.create({
    data: {
      fullName: `${NAME_PREFIX} ${suffix}`,
      documentId: `${DOC_PREFIX}${docCounter}`,
      category,
      isJoven: opts.isJoven ?? false,
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

async function finalizeDirectly(monthCycleId) {
  await prisma.monthCycle.update({ where: { id: monthCycleId }, data: { status: "FINALIZED", finalizedAt: new Date() } });
}

/** Mes con equipos regulares + equipo YOUTH + horario (incluye YOUTH_SERVICE) ya generados. */
async function setupMonthWithYouthTeam({ year, month, teamCount = 2, youthSize = 2 }) {
  await Promise.all(
    Array.from({ length: teamCount + 1 }, (_, i) => makePerson("INSTRUCTOR", `${year}-${month} Instr ${i + 1}`))
  );
  await Promise.all(
    Array.from({ length: teamCount * 2 }, (_, i) => makePerson("MINISTRO", `${year}-${month} Min ${i + 1}`))
  );
  const leader = await makePerson("MINISTRO", `${year}-${month} Youth Leader`, { isJoven: true });
  await Promise.all(
    Array.from({ length: youthSize - 1 }, (_, i) => makePerson("MINISTRO", `${year}-${month} Youth Colab ${i + 1}`, { isJoven: true }))
  );

  const monthCycle = await createMonth(year, month, teamCount);
  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`)).send({
    youthTeam: { enabled: true, size: youthSize, leaderPersonId: leader.id },
  });
  expect(gen.status).toBe(200);

  const sched = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
  expect(sched.status).toBe(200);

  const youthTeam = gen.body.teams.find((t) => t.teamType === "YOUTH");
  const youthSlot = sched.body.slots.find((s) => s.slotType === "YOUTH_SERVICE");

  return { monthCycle, teams: gen.body.teams, slots: sched.body.slots, youthTeam, youthSlot };
}

/** Mes con equipos regulares + horario, SIN equipo de jóvenes. */
async function setupMonthWithoutYouthTeam({ year, month, teamCount = 1 }) {
  await Promise.all(
    Array.from({ length: teamCount + 1 }, (_, i) => makePerson("INSTRUCTOR", `${year}-${month} Instr ${i + 1}`))
  );
  await Promise.all(
    Array.from({ length: teamCount * 2 }, (_, i) => makePerson("MINISTRO", `${year}-${month} Min ${i + 1}`))
  );

  const monthCycle = await createMonth(year, month, teamCount);
  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`));
  expect(gen.status).toBe(200);

  const sched = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
  expect(sched.status).toBe(200);

  return { monthCycle, teams: gen.body.teams, slots: sched.body.slots };
}

describe("POST /api/months/:id/youth-team/cancel", () => {
  it("cancela el turno YOUTH_SERVICE (cancelledAt, countsTowardBalance: false, sin equipo asignado) y conserva el Team YOUTH con sus integrantes", async () => {
    const { monthCycle, youthTeam, youthSlot } = await setupMonthWithYouthTeam({ year: 2086, month: 1, teamCount: 2 });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/youth-team/cancel`));
    expect(res.status).toBe(200);
    expect(res.body.slot.id).toBe(youthSlot.id);
    expect(res.body.slot.cancelledAt).not.toBeNull();
    expect(res.body.slot.countsTowardBalance).toBe(false);
    expect(res.body.slot.teams).toEqual([]);

    const remainingAssignments = await prisma.slotAssignment.count({ where: { serviceSlotId: youthSlot.id } });
    expect(remainingAssignments).toBe(0);

    // El Team YOUTH y sus integrantes se conservan intactos.
    const teamsRes = await authed(request(app).get(`/api/months/${monthCycle.id}/teams`));
    expect(teamsRes.status).toBe(200);
    const stillThere = teamsRes.body.teams.find((t) => t.id === youthTeam.id);
    expect(stillThere).toBeDefined();
    expect(stillThere.members.length).toBe(youthTeam.members.length);
  });

  it("cancelar prevalece sobre una asignación bloqueada (locked)", async () => {
    const { monthCycle, youthSlot } = await setupMonthWithYouthTeam({ year: 2086, month: 2, teamCount: 2 });
    const assignmentId = youthSlot.teams[0].assignmentId;

    const lockRes = await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({ locked: true });
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.assignment.locked).toBe(true);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/youth-team/cancel`));
    expect(res.status).toBe(200);
    expect(res.body.slot.teams).toEqual([]);
  });

  it("404 SERVICIO_JOVENES_NO_ENCONTRADO si el mes no tiene turno YOUTH_SERVICE generado", async () => {
    const { monthCycle } = await setupMonthWithoutYouthTeam({ year: 2086, month: 3, teamCount: 1 });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/youth-team/cancel`));
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("SERVICIO_JOVENES_NO_ENCONTRADO");
  });

  it("409 SERVICIO_JOVENES_YA_CANCELADO al cancelar dos veces", async () => {
    const { monthCycle } = await setupMonthWithYouthTeam({ year: 2086, month: 4, teamCount: 1, youthSize: 2 });

    const first = await authed(request(app).post(`/api/months/${monthCycle.id}/youth-team/cancel`));
    expect(first.status).toBe(200);

    const second = await authed(request(app).post(`/api/months/${monthCycle.id}/youth-team/cancel`));
    expect(second.status).toBe(409);
    expect(second.body.error.details.code).toBe("SERVICIO_JOVENES_YA_CANCELADO");
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).post("/api/months/no-existe-este-mes/youth-team/cancel"));
    expect(res.status).toBe(404);
  });

  it("200 en un mes DRAFT sin ninguna restricción de fecha", async () => {
    const { monthCycle } = await setupMonthWithYouthTeam({ year: 2086, month: 5, teamCount: 1, youthSize: 2 });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/youth-team/cancel`));
    expect(res.status).toBe(200);
  });

  it("200 en un mes FINALIZED actual o futuro", async () => {
    const { monthCycle } = await setupMonthWithYouthTeam({ year: 2086, month: 6, teamCount: 1, youthSize: 2 });
    await finalizeDirectly(monthCycle.id);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/youth-team/cancel`));
    expect(res.status).toBe(200);
  });

  it("409 MES_PASADO en un mes FINALIZED que ya pasó", async () => {
    const { monthCycle } = await setupMonthWithYouthTeam({ year: 2018, month: 1, teamCount: 1, youthSize: 2 });
    await finalizeDirectly(monthCycle.id);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/youth-team/cancel`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_PASADO");
  });

  it("invalida la caché pública: GET /api/schedule/:year/:month refleja la cancelación", async () => {
    const { monthCycle } = await setupMonthWithYouthTeam({ year: 2086, month: 7, teamCount: 1, youthSize: 2 });
    await finalizeDirectly(monthCycle.id);

    // Parte 3 (wise-noodling-hickey.md): 2086 es décadas en el futuro, así
    // que sin fijar "hoy" dentro del mismo mes la lectura pública de abajo
    // daría 404 (mes futuro no adelantado) en vez de 200 (ver boilerplate al
    // inicio del archivo).
    currentCivilDateMock.mockReturnValue({ year: 2086, month: 7, day: 15 });
    try {
      const before = await request(app).get(`/api/schedule/${monthCycle.year}/${monthCycle.month}`);
      expect(before.status).toBe(200);
      const beforeSlot = before.body.slots.find((s) => s.slotType === "YOUTH_SERVICE");
      expect(beforeSlot.cancelledAt).toBeNull();

      const res = await authed(request(app).post(`/api/months/${monthCycle.id}/youth-team/cancel`));
      expect(res.status).toBe(200);

      const after = await request(app).get(`/api/schedule/${monthCycle.year}/${monthCycle.month}`);
      expect(after.status).toBe(200);
      const afterSlot = after.body.slots.find((s) => s.slotType === "YOUTH_SERVICE");
      expect(afterSlot.cancelledAt).not.toBeNull();
    } finally {
      currentCivilDateMock.mockImplementation(delegateToReal);
    }
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).post("/api/months/cualquier-id/youth-team/cancel");
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/months/:id/youth-team", () => {
  it("borra el Team YOUTH, su ServiceSlot YOUTH_SERVICE y sus TeamMember/SlotAssignment (cascada)", async () => {
    const { monthCycle, youthTeam, youthSlot } = await setupMonthWithYouthTeam({ year: 2087, month: 1, teamCount: 2 });

    const res = await authed(request(app).delete(`/api/months/${monthCycle.id}/youth-team`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });

    const teamsRes = await authed(request(app).get(`/api/months/${monthCycle.id}/teams`));
    expect(teamsRes.body.teams.some((t) => t.id === youthTeam.id)).toBe(false);

    const scheduleRes = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    expect(scheduleRes.body.slots.some((s) => s.id === youthSlot.id)).toBe(false);

    const remainingMembers = await prisma.teamMember.count({ where: { teamId: youthTeam.id } });
    expect(remainingMembers).toBe(0);
    const remainingAssignments = await prisma.slotAssignment.count({ where: { serviceSlotId: youthSlot.id } });
    expect(remainingAssignments).toBe(0);

    const monthAfter = await authed(request(app).get(`/api/months/${monthCycle.id}`));
    expect(monthAfter.body.youthTeamEnabled).toBe(false);
  });

  it("404 EQUIPO_JOVENES_NO_ENCONTRADO si el mes no tiene equipo de jóvenes", async () => {
    const { monthCycle } = await setupMonthWithoutYouthTeam({ year: 2087, month: 2, teamCount: 1 });

    const res = await authed(request(app).delete(`/api/months/${monthCycle.id}/youth-team`));
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("EQUIPO_JOVENES_NO_ENCONTRADO");
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).delete("/api/months/no-existe-este-mes/youth-team"));
    expect(res.status).toBe(404);
  });

  it("200 en un mes DRAFT sin ninguna restricción de fecha", async () => {
    const { monthCycle } = await setupMonthWithYouthTeam({ year: 2087, month: 3, teamCount: 1, youthSize: 2 });

    const res = await authed(request(app).delete(`/api/months/${monthCycle.id}/youth-team`));
    expect(res.status).toBe(200);
  });

  it("200 en un mes FINALIZED actual o futuro", async () => {
    const { monthCycle } = await setupMonthWithYouthTeam({ year: 2087, month: 4, teamCount: 1, youthSize: 2 });
    await finalizeDirectly(monthCycle.id);

    const res = await authed(request(app).delete(`/api/months/${monthCycle.id}/youth-team`));
    expect(res.status).toBe(200);
  });

  it("409 MES_PASADO en un mes FINALIZED que ya pasó", async () => {
    const { monthCycle } = await setupMonthWithYouthTeam({ year: 2018, month: 2, teamCount: 1, youthSize: 2 });
    await finalizeDirectly(monthCycle.id);

    const res = await authed(request(app).delete(`/api/months/${monthCycle.id}/youth-team`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_PASADO");
  });

  it("invalida la caché pública: GET /api/schedule/:year/:month deja de incluir el turno YOUTH_SERVICE", async () => {
    const { monthCycle } = await setupMonthWithYouthTeam({ year: 2087, month: 5, teamCount: 1, youthSize: 2 });
    await finalizeDirectly(monthCycle.id);

    // Mismo motivo que el test de cancelación de arriba: fijar "hoy" dentro
    // de 2087-05 para que la Parte 3 no bloquee las lecturas públicas.
    currentCivilDateMock.mockReturnValue({ year: 2087, month: 5, day: 15 });
    try {
      const before = await request(app).get(`/api/schedule/${monthCycle.year}/${monthCycle.month}`);
      expect(before.status).toBe(200);
      expect(before.body.slots.some((s) => s.slotType === "YOUTH_SERVICE")).toBe(true);

      const res = await authed(request(app).delete(`/api/months/${monthCycle.id}/youth-team`));
      expect(res.status).toBe(200);

      const after = await request(app).get(`/api/schedule/${monthCycle.year}/${monthCycle.month}`);
      expect(after.status).toBe(200);
      expect(after.body.slots.some((s) => s.slotType === "YOUTH_SERVICE")).toBe(false);
    } finally {
      currentCivilDateMock.mockImplementation(delegateToReal);
    }
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).delete("/api/months/cualquier-id/youth-team");
    expect(res.status).toBe(401);
  });
});
