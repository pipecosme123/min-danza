// Fase 4c: agregar/cancelar/eliminar un evento extraordinario y cambiar el
// uniforme de un turno puntual, incluso después de publicar el mes, mientras
// el mes sea el actual o uno futuro (nunca uno que ya pasó). Contrato
// cerrado: docs/architecture/phase4c-post-publish-edits-contract.md. Golpea
// la base Postgres real de desarrollo (mismo patrón que events.test.js).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA 4C";
const DOC_PREFIX = `QA4C${RUN_ID}`;
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

  if (preExistingActiveIds.length > 0) {
    await prisma.person.updateMany({ where: { id: { in: preExistingActiveIds } }, data: { active: true } });
  }

  await prisma.uniform.deleteMany({ where: { id: { in: createdUniformIds } } });

  await prisma.$disconnect();
});

function authed(req) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function makePerson(category, suffix) {
  docCounter += 1;
  const person = await prisma.person.create({
    data: { fullName: `${NAME_PREFIX} ${suffix}`, documentId: `${DOC_PREFIX}${docCounter}`, category, active: true },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function makeUniform(suffix) {
  const uniform = await prisma.uniform.create({
    data: { name: `${NAME_PREFIX} Uniforme ${suffix} ${RUN_ID}`, colorHex: "#112233" },
  });
  createdUniformIds.push(uniform.id);
  return uniform;
}

async function createMonth(year, month, teamCount) {
  const res = await authed(request(app).post("/api/months")).send({ year, month, teamCount });
  expect(res.status).toBe(201);
  createdMonthCycleIds.push(res.body.id);
  return res.body;
}

async function setupMonthWithSchedule({ year, month, teamCount, instructors = teamCount + 1, ministros = teamCount * 2 }) {
  await Promise.all(Array.from({ length: instructors }, (_, i) => makePerson("INSTRUCTOR", `${year}-${month} Instr ${i + 1}`)));
  await Promise.all(Array.from({ length: ministros }, (_, i) => makePerson("MINISTRO", `${year}-${month} Min ${i + 1}`)));

  const monthCycle = await createMonth(year, month, teamCount);
  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`));
  expect(gen.status).toBe(200);

  const sched = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
  expect(sched.status).toBe(200);

  return { monthCycle, teams: gen.body.teams, slots: sched.body.slots };
}

async function finalizeDirectly(monthCycleId) {
  // Mismo atajo que events.test.js/scheduleGeneration.test.js: forzar el
  // status a mano evita tener que satisfacer todas las precondiciones del
  // flujo POST /finalize real (que no son el foco de esta suite).
  await prisma.monthCycle.update({ where: { id: monthCycleId }, data: { status: "FINALIZED", finalizedAt: new Date() } });
}

function midMonthDate(monthCycle) {
  return `${monthCycle.year}-${String(monthCycle.month).padStart(2, "0")}-10`;
}

/** Map assignmentId -> { teamId, locked, slotId }, para comparar "antes/después" sin ambigüedad. */
function snapshotAssignments(slots) {
  const map = new Map();
  for (const slot of slots) {
    for (const team of slot.teams) {
      map.set(team.assignmentId, { teamId: team.id, locked: team.locked, slotId: slot.id });
    }
  }
  return map;
}

describe("Fase 4c: mes FINALIZED actual/futuro admite agregar/cancelar/eliminar eventos y cambiar uniforme de un turno", () => {
  it("POST .../events crea el evento y asigna equipo(s) SIN mover ninguna otra asignación ya publicada", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2099, month: 1, teamCount: 3 });
    await finalizeDirectly(monthCycle.id);

    const before = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    expect(before.status).toBe(200);
    const beforeSnapshot = snapshotAssignments(before.body.slots);
    expect(beforeSnapshot.size).toBeGreaterThan(0);

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA4C Evento Post-Publish",
      teamsNeeded: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.slot.teams).toHaveLength(1);

    const after = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const afterSnapshot = snapshotAssignments(after.body.slots.filter((s) => s.id !== res.body.slot.id));

    expect(afterSnapshot.size).toBe(beforeSnapshot.size);
    for (const [assignmentId, info] of beforeSnapshot) {
      expect(afterSnapshot.get(assignmentId)).toEqual(info);
    }
  });

  it("DELETE .../events/:id no dispara ningún recompute (nada se reacomoda, aunque libere un hueco)", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2099, month: 2, teamCount: 3 });

    // Crear el evento ANTES de finalizar (todavía DRAFT) para poder borrarlo después de publicar.
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA4C Borrar Post-Publish",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    await finalizeDirectly(monthCycle.id);

    const before = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const beforeSnapshot = snapshotAssignments(before.body.slots.filter((s) => s.id !== created.body.slot.id));

    const res = await authed(request(app).delete(`/api/events/${created.body.slot.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });

    const after = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    expect(after.body.slots.some((s) => s.id === created.body.slot.id)).toBe(false);

    const afterSnapshot = snapshotAssignments(after.body.slots);
    expect(afterSnapshot.size).toBe(beforeSnapshot.size);
    for (const [assignmentId, info] of beforeSnapshot) {
      expect(afterSnapshot.get(assignmentId)).toEqual(info);
    }
  });

  it("PATCH /api/slots/:id cambia el uniforme de un único turno SIN tocar ningún otro ServiceSlot", async () => {
    const { monthCycle, slots } = await setupMonthWithSchedule({ year: 2099, month: 3, teamCount: 2 });
    await finalizeDirectly(monthCycle.id);

    const uniform = await makeUniform("Post Publish");
    const targetSlot = slots.find((s) => s.slotType === "FIXED");
    const otherSlotsBefore = slots.filter((s) => s.id !== targetSlot.id).map((s) => ({ id: s.id, uniform: s.uniform }));

    const res = await authed(request(app).patch(`/api/slots/${targetSlot.id}`)).send({ uniformId: uniform.id });
    expect(res.status).toBe(200);
    expect(res.body.slot.uniform).toMatchObject({ id: uniform.id });

    const after = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const targetAfter = after.body.slots.find((s) => s.id === targetSlot.id);
    expect(targetAfter.uniform).toMatchObject({ id: uniform.id });

    for (const other of otherSlotsBefore) {
      const otherAfter = after.body.slots.find((s) => s.id === other.id);
      expect(otherAfter.uniform).toEqual(other.uniform);
    }
  });
});

describe("POST /api/events/:eventId/cancel", () => {
  it("marca cancelledAt, countsTowardBalance: false y borra sus SlotAssignment (incluida una locked)", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2099, month: 4, teamCount: 2 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA4C Cancelar",
      teamsNeeded: 2,
    });
    expect(created.status).toBe(201);
    expect(created.body.slot.teams).toHaveLength(2);
    expect(created.body.slot.cancelledAt).toBeNull();

    // Bloquear una de las asignaciones para confirmar que cancelar prevalece sobre el lock.
    const assignmentId = created.body.slot.teams[0].assignmentId;
    const lockRes = await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({ locked: true });
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.assignment.locked).toBe(true);

    const res = await authed(request(app).post(`/api/events/${created.body.slot.id}/cancel`));
    expect(res.status).toBe(200);
    expect(res.body.slot.id).toBe(created.body.slot.id);
    expect(res.body.slot.cancelledAt).not.toBeNull();
    expect(res.body.slot.countsTowardBalance).toBe(false);
    expect(res.body.slot.teams).toEqual([]);

    const remaining = await prisma.slotAssignment.count({ where: { serviceSlotId: created.body.slot.id } });
    expect(remaining).toBe(0);
  });

  it("409 EVENTO_YA_CANCELADO al cancelar dos veces", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2099, month: 5, teamCount: 1 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA4C Cancelar Dos Veces",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    const first = await authed(request(app).post(`/api/events/${created.body.slot.id}/cancel`));
    expect(first.status).toBe(200);

    const second = await authed(request(app).post(`/api/events/${created.body.slot.id}/cancel`));
    expect(second.status).toBe(409);
    expect(second.body.error.details.code).toBe("EVENTO_YA_CANCELADO");
  });

  it("404 EVENTO_NO_ENCONTRADO si el evento no existe", async () => {
    const res = await authed(request(app).post("/api/events/no-existe-este-evento/cancel"));
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("EVENTO_NO_ENCONTRADO");
  });

  it("404 EVENTO_NO_ENCONTRADO al intentar cancelar un slot FIXED", async () => {
    const { slots } = await setupMonthWithSchedule({ year: 2099, month: 6, teamCount: 1 });
    const fixedSlot = slots.find((s) => s.slotType === "FIXED");

    const res = await authed(request(app).post(`/api/events/${fixedSlot.id}/cancel`));
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("EVENTO_NO_ENCONTRADO");
  });

  it("funciona en un mes DRAFT sin ninguna restricción de fecha", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2099, month: 8, teamCount: 1 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA4C Cancelar Draft",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    const res = await authed(request(app).post(`/api/events/${created.body.slot.id}/cancel`));
    expect(res.status).toBe(200);
    expect(res.body.slot.cancelledAt).not.toBeNull();
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).post("/api/events/cualquier-id/cancel");
    expect(res.status).toBe(401);
  });
});

describe("Fase 4c: mes FINALIZED que ya pasó -> 409 MES_PASADO en las cuatro acciones relajadas", () => {
  it("POST .../events, DELETE .../events/:id, POST .../cancel y PATCH /api/slots/:id devuelven 409 MES_PASADO", async () => {
    const { monthCycle, slots } = await setupMonthWithSchedule({ year: 2019, month: 1, teamCount: 2 });

    // Crear el evento a borrar/cancelar ANTES de finalizar (todavía DRAFT).
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA4C Mes Pasado Existente",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    await finalizeDirectly(monthCycle.id);

    const createRes = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "20:00",
      title: "QA4C Mes Pasado Nuevo",
      teamsNeeded: 1,
    });
    expect(createRes.status).toBe(409);
    expect(createRes.body.error.details.code).toBe("MES_PASADO");

    const cancelRes = await authed(request(app).post(`/api/events/${created.body.slot.id}/cancel`));
    expect(cancelRes.status).toBe(409);
    expect(cancelRes.body.error.details.code).toBe("MES_PASADO");

    const deleteRes = await authed(request(app).delete(`/api/events/${created.body.slot.id}`));
    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.error.details.code).toBe("MES_PASADO");

    const fixedSlot = slots.find((s) => s.slotType === "FIXED");
    const uniformRes = await authed(request(app).patch(`/api/slots/${fixedSlot.id}`)).send({ uniformId: null });
    expect(uniformRes.status).toBe(409);
    expect(uniformRes.body.error.details.code).toBe("MES_PASADO");
  });
});

describe("Fase 4c: la página pública refleja los cambios post-publicación (invalidación de caché)", () => {
  it("GET /api/schedule/:year/:month refleja un evento agregado después de publicar, sin servir caché vieja", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2099, month: 9, teamCount: 2 });
    await finalizeDirectly(monthCycle.id);

    // Poblar la caché pública con el estado ANTES del evento nuevo.
    const before = await request(app).get(`/api/schedule/${monthCycle.year}/${monthCycle.month}`);
    expect(before.status).toBe(200);
    expect(before.body.slots.some((s) => s.title === "QA4C Cache")).toBe(false);

    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA4C Cache",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    const after = await request(app).get(`/api/schedule/${monthCycle.year}/${monthCycle.month}`);
    expect(after.status).toBe(200);
    expect(after.body.slots.some((s) => s.title === "QA4C Cache")).toBe(true);
  });
});

describe("PATCH /api/events/:eventId (edición completa) sigue bloqueado sin excepción de fecha", () => {
  it("409 MES_FINALIZADO (no MES_PASADO) para un mes FINALIZED actual/futuro", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2099, month: 7, teamCount: 1 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA4C Editar Bloqueado Futuro",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    await finalizeDirectly(monthCycle.id);

    const res = await authed(request(app).patch(`/api/events/${created.body.slot.id}`)).send({ title: "X" });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_FINALIZADO");
  });

  it("409 MES_FINALIZADO (no MES_PASADO) para un mes FINALIZED que ya pasó", async () => {
    const { monthCycle } = await setupMonthWithSchedule({ year: 2019, month: 2, teamCount: 1 });
    const created = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: midMonthDate(monthCycle),
      startTime: "19:00",
      title: "QA4C Editar Bloqueado Pasado",
      teamsNeeded: 1,
    });
    expect(created.status).toBe(201);

    await finalizeDirectly(monthCycle.id);

    const res = await authed(request(app).patch(`/api/events/${created.body.slot.id}`)).send({ title: "X" });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_FINALIZADO");
  });
});
