// POST /api/months/:id/generate-schedule, GET /api/months/:id/schedule,
// recomputeBalance (ejercitado a través de esos endpoints y de eventos), e
// interacción con generate-teams (Fase 3). Contrato completo en
// docs/architecture/phase4-schedule-contract.md, refinado por
// docs/architecture/phase4b-schedule-refinements-contract.md §1.2, §2 y §5.2
// (sin defaults automáticos de uniforme, preferencia de semana en el
// balance, regenerar preserva EXTRAORDINARY). Golpea la base Postgres real
// de desarrollo (mismo patrón que teamGeneration.test.js).
//
// Igual que teamGeneration.test.js: el pool de sorteo es GLOBAL a toda
// persona activa de la base, así que este archivo aísla temporalmente a
// cualquier INSTRUCTOR/MINISTRO activo preexistente.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { weekdaysIn, lastSundayOf, lastSaturdayOf, formatCivilDate, mondayOfWeek } from "../src/utils/dates.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA SCHED";
const DOC_PREFIX = `QASC${RUN_ID}`;
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

function parseCivilDate(str) {
  const [year, month, day] = str.split("-").map(Number);
  return { year, month, day };
}

function weekKeyOf(dateStr) {
  const { year, month, day } = mondayOfWeek(parseCivilDate(dateStr));
  return `${year}-${month}-${day}`;
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

/** Crea instructores/ministros suficientes y sortea equipos (sin jóvenes por defecto). */
async function setupMonthWithTeams({ year, month, teamCount, instructors = teamCount + 1, ministros = teamCount * 2, youthTeam }) {
  const instructorPeople = await Promise.all(
    Array.from({ length: instructors }, (_, i) => makePerson("INSTRUCTOR", `${year}-${month} Instr ${i + 1}`))
  );
  const ministroPeople = await Promise.all(
    Array.from({ length: ministros }, (_, i) => makePerson("MINISTRO", `${year}-${month} Min ${i + 1}`))
  );

  const monthCycle = await createMonth(year, month, teamCount);
  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`)).send(
    youthTeam ? { youthTeam } : {}
  );
  expect(gen.status).toBe(200);

  return { monthCycle, teams: gen.body.teams, instructorPeople, ministroPeople };
}

describe("POST /api/months/:id/generate-schedule", () => {
  it("genera los slots fijos correctos con la excepción del último domingo, sin YOUTH_SERVICE si no hay equipo de jóvenes, todos sin uniforme y sin warnings", async () => {
    const year = 2093;
    const month = 3;
    const { monthCycle } = await setupMonthWithTeams({ year, month, teamCount: 2 });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(res.status).toBe(200);

    const wednesdays = weekdaysIn(year, month, 3);
    const sundays = weekdaysIn(year, month, 0);
    const lastSunday = lastSundayOf(year, month);

    const expectedWedSlots = wednesdays.length * 2;
    const expectedSunSlots = (sundays.length - 1) * 2 + 1;
    expect(res.body.slots).toHaveLength(expectedWedSlots + expectedSunSlots);

    // Excepción del último domingo: un solo slot 08:00 con teamsNeeded 2, sin 10:30.
    const lastSundayStr = formatCivilDate(lastSunday);
    const lastSundaySlots = res.body.slots.filter((s) => s.date === lastSundayStr);
    expect(lastSundaySlots).toHaveLength(1);
    expect(lastSundaySlots[0]).toMatchObject({ startTime: "08:00", teamsNeeded: 2, slotType: "FIXED" });
    expect(lastSundaySlots[0].teams).toHaveLength(2);

    // Ningún slot 10:30 el último domingo.
    expect(res.body.slots.some((s) => s.date === lastSundayStr && s.startTime === "10:30")).toBe(false);

    // Sin equipo YOUTH -> no se genera YOUTH_SERVICE.
    expect(res.body.slots.some((s) => s.slotType === "YOUTH_SERVICE")).toBe(false);

    // Fase 4b §1.2: ya no hay defaults automáticos de uniforme; todo slot
    // nace sin uniforme y no hay ningún warning de "no configurado".
    expect(res.body.slots.every((s) => s.uniform === null)).toBe(true);
    expect(res.body.warnings).toEqual([]);
  });

  it("genera el slot YOUTH_SERVICE con el equipo YOUTH del mes, sin uniforme (Fase 4b)", async () => {
    const year = 2093;
    const month = 4;

    const leader = await makePerson("MINISTRO", "Youth Sched Leader", { isJoven: true });
    const collaborators = await Promise.all(
      Array.from({ length: 3 }, (_, i) => makePerson("MINISTRO", `Youth Sched Colab ${i + 1}`, { isJoven: true }))
    );

    const { monthCycle } = await setupMonthWithTeams({
      year,
      month,
      teamCount: 2,
      youthTeam: { enabled: true, size: 4, leaderPersonId: leader.id },
    });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);

    const lastSaturday = lastSaturdayOf(year, month);
    const youthSlot = res.body.slots.find((s) => s.slotType === "YOUTH_SERVICE");
    expect(youthSlot).toBeDefined();
    expect(youthSlot).toMatchObject({
      date: formatCivilDate(lastSaturday),
      startTime: "18:50",
      title: "Servicio de jóvenes",
      teamsNeeded: 1,
      countsTowardBalance: true,
      uniform: null,
    });
    expect(youthSlot.teams).toHaveLength(1);

    const teamsList = await authed(request(app).get(`/api/months/${monthCycle.id}/teams`));
    const youthTeam = teamsList.body.teams.find((t) => t.teamType === "YOUTH");
    expect(youthSlot.teams[0].id).toBe(youthTeam.id);

    await retirePeople([leader, ...collaborators]);
  });

  it("409 EQUIPOS_NO_GENERADOS si el mes no tiene equipos regulares", async () => {
    const monthCycle = await createMonth(2093, 5, 2);
    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("EQUIPOS_NO_GENERADOS");
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).post("/api/months/no-existe-este-id/generate-schedule"));
    expect(res.status).toBe(404);
  });

  it("409 MES_FINALIZADO si el mes ya no está DRAFT", async () => {
    const { monthCycle } = await setupMonthWithTeams({ year: 2093, month: 6, teamCount: 1 });
    await prisma.monthCycle.update({ where: { id: monthCycle.id }, data: { status: "FINALIZED" } });

    const res = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_FINALIZADO");
  });

  it("llamada repetida sin regenerate es idempotente (no duplica ni cambia)", async () => {
    const { monthCycle } = await setupMonthWithTeams({ year: 2093, month: 7, teamCount: 2 });

    const first = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(first.status).toBe(200);
    const firstIds = first.body.slots.map((s) => s.id).sort();

    const second = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(second.status).toBe(200);
    const secondIds = second.body.slots.map((s) => s.id).sort();

    expect(secondIds).toEqual(firstIds);
    expect(second.body.warnings).toEqual([]);
  });

  it("regenerate: true borra y reconstruye los FIXED/YOUTH_SERVICE", async () => {
    const { monthCycle } = await setupMonthWithTeams({ year: 2093, month: 8, teamCount: 2 });

    const first = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(first.status).toBe(200);
    const firstIds = first.body.slots.map((s) => s.id).sort();

    const second = await authed(
      request(app).post(`/api/months/${monthCycle.id}/generate-schedule`)
    ).send({ regenerate: true });
    expect(second.status).toBe(200);
    const secondIds = second.body.slots.map((s) => s.id).sort();

    expect(secondIds).not.toEqual(firstIds);
    expect(second.body.slots).toHaveLength(first.body.slots.length);
  });

  it("regenerate: true PRESERVA los ServiceSlot EXTRAORDINARY (con y sin locked) y su participación en el balance (Fase 4b §5.2)", async () => {
    const { monthCycle } = await setupMonthWithTeams({ year: 2093, month: 9, teamCount: 2, instructors: 4, ministros: 4 });

    const first = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(first.status).toBe(200);

    // Evento SIN locked.
    const eventA = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: `${monthCycle.year}-${String(monthCycle.month).padStart(2, "0")}-10`,
      startTime: "19:30",
      title: "QA Preserva Sin Lock",
      teamsNeeded: 1,
    });
    expect(eventA.status).toBe(201);

    // Evento CON una asignación locked.
    const eventB = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: `${monthCycle.year}-${String(monthCycle.month).padStart(2, "0")}-12`,
      startTime: "20:00",
      title: "QA Preserva Con Lock",
      teamsNeeded: 1,
    });
    expect(eventB.status).toBe(201);
    const eventBAssignmentId = eventB.body.slot.teams[0].assignmentId;
    const eventBTeamId = eventB.body.slot.teams[0].id;
    const lockRes = await authed(request(app).patch(`/api/assignments/${eventBAssignmentId}`)).send({ locked: true });
    expect(lockRes.status).toBe(200);

    const beforeSchedule = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const fixedIdsBefore = beforeSchedule.body.slots.filter((s) => s.slotType === "FIXED").map((s) => s.id).sort();

    const regen = await authed(
      request(app).post(`/api/months/${monthCycle.id}/generate-schedule`)
    ).send({ regenerate: true });
    expect(regen.status).toBe(200);

    // Los FIXED cambiaron de id (se regeneraron).
    const fixedIdsAfter = regen.body.slots.filter((s) => s.slotType === "FIXED").map((s) => s.id).sort();
    expect(fixedIdsAfter).not.toEqual(fixedIdsBefore);

    // Los EXTRAORDINARY sobreviven con el MISMO id y siguen en GET .../schedule.
    const eventASlot = regen.body.slots.find((s) => s.id === eventA.body.slot.id);
    expect(eventASlot).toBeDefined();
    expect(eventASlot.slotType).toBe("EXTRAORDINARY");
    expect(eventASlot.title).toBe("QA Preserva Sin Lock");

    const eventBSlot = regen.body.slots.find((s) => s.id === eventB.body.slot.id);
    expect(eventBSlot).toBeDefined();
    expect(eventBSlot.title).toBe("QA Preserva Con Lock");
    // La asignación locked del evento B sigue siendo el mismo equipo, y sigue locked.
    const stillLocked = eventBSlot.teams.find((t) => t.assignmentId === eventBAssignmentId);
    expect(stillLocked).toBeDefined();
    expect(stillLocked.id).toBe(eventBTeamId);
    expect(stillLocked.locked).toBe(true);

    // El balance final considera la participación de ambos extraordinarios.
    const afterSchedule = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const totalCounts = afterSchedule.body.balance.reduce((sum, b) => sum + b.count, 0);
    const totalTeamsNeeded = afterSchedule.body.slots
      .filter((s) => s.countsTowardBalance && s.slotType !== "YOUTH_SERVICE")
      .reduce((sum, s) => sum + s.teamsNeeded, 0);
    expect(totalCounts).toBe(totalTeamsNeeded);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).post("/api/months/cualquier-id/generate-schedule");
    expect(res.status).toBe(401);
  });
});

describe("recomputeBalance", () => {
  it("reparte equipos REGULAR por menor conteo acumulado (balance parejo)", async () => {
    const { monthCycle } = await setupMonthWithTeams({ year: 2093, month: 10, teamCount: 3 });

    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(gen.status).toBe(200);

    const schedule = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    expect(schedule.status).toBe(200);
    expect(schedule.body.balance).toHaveLength(3);

    const counts = schedule.body.balance.map((b) => b.count);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    expect(max - min).toBeLessThanOrEqual(1);

    const totalTeamsNeeded = gen.body.slots
      .filter((s) => s.countsTowardBalance && s.slotType !== "YOUTH_SERVICE")
      .reduce((sum, s) => sum + s.teamsNeeded, 0);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(totalTeamsNeeded);
  });

  it("respeta las asignaciones locked: true, no las mueve al recalcular (vía creación de un evento)", async () => {
    const { monthCycle } = await setupMonthWithTeams({ year: 2093, month: 11, teamCount: 2 });

    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(gen.status).toBe(200);

    const fixedSlotWithAssignment = gen.body.slots.find((s) => s.slotType === "FIXED" && s.teams.length === 1);
    const assignmentId = fixedSlotWithAssignment.teams[0].assignmentId;
    const lockedTeamId = fixedSlotWithAssignment.teams[0].id;

    const lockRes = await authed(request(app).patch(`/api/assignments/${assignmentId}`)).send({ locked: true });
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.assignment.locked).toBe(true);

    // Cualquier fecha del mes (excluyendo el último sábado/domingo no es
    // relevante acá): usamos el día 10, que en cualquier mes cae dentro del rango 1-28.
    const eventRes = await authed(request(app).post(`/api/months/${monthCycle.id}/events`)).send({
      date: `${monthCycle.year}-${String(monthCycle.month).padStart(2, "0")}-10`,
      startTime: "19:30",
      title: "QA Evento Balance",
      teamsNeeded: 1,
    });
    expect(eventRes.status).toBe(201);

    const afterSchedule = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const stillThere = afterSchedule.body.slots
      .find((s) => s.id === fixedSlotWithAssignment.id)
      .teams.find((t) => t.assignmentId === assignmentId);

    expect(stillThere).toBeDefined();
    expect(stillThere.id).toBe(lockedTeamId);
    expect(stillThere.locked).toBe(true);
  });

  it("el slot YOUTH_SERVICE siempre va al equipo YOUTH y nunca compite por balance", async () => {
    const leader = await makePerson("MINISTRO", "Youth Balance Leader", { isJoven: true });
    const collaborators = await Promise.all(
      Array.from({ length: 2 }, (_, i) => makePerson("MINISTRO", `Youth Balance Colab ${i + 1}`, { isJoven: true }))
    );

    const { monthCycle } = await setupMonthWithTeams({
      year: 2093,
      month: 12,
      teamCount: 2,
      youthTeam: { enabled: true, size: 3, leaderPersonId: leader.id },
    });

    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(gen.status).toBe(200);

    const teamsList = await authed(request(app).get(`/api/months/${monthCycle.id}/teams`));
    const youthTeam = teamsList.body.teams.find((t) => t.teamType === "YOUTH");

    const schedule = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    expect(schedule.body.balance).toHaveLength(2); // solo los 2 REGULAR, YOUTH no aparece
    expect(schedule.body.balance.some((b) => b.teamId === youthTeam.id)).toBe(false);

    const youthSlot = schedule.body.slots.find((s) => s.slotType === "YOUTH_SERVICE");
    expect(youthSlot.teams).toHaveLength(1);
    expect(youthSlot.teams[0].id).toBe(youthTeam.id);

    await retirePeople([leader, ...collaborators]);
  });

  it("con equipos suficientes (>= turnos-por-semana), preferir NO repetir equipo en la misma semana ISO (Fase 4b §2)", async () => {
    // 10 equipos regulares >> el máximo de slots que puede haber en una sola
    // semana (2 miércoles + 2 domingo = 4, o 2 miércoles + 1 último domingo
    // con teamsNeeded 2 = 4) -> siempre es matemáticamente posible que
    // ninguna semana repita equipo entre sus slots FIXED.
    const { monthCycle } = await setupMonthWithTeams({ year: 2094, month: 3, teamCount: 10, instructors: 11, ministros: 20 });

    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(gen.status).toBe(200);

    const byWeek = new Map();
    for (const slot of gen.body.slots) {
      if (slot.slotType !== "FIXED") continue;
      const week = weekKeyOf(slot.date);
      if (!byWeek.has(week)) byWeek.set(week, []);
      for (const t of slot.teams) byWeek.get(week).push(t.id);
    }

    for (const [, teamIds] of byWeek) {
      const unique = new Set(teamIds);
      expect(unique.size).toBe(teamIds.length);
    }
  });

  it("con MENOS equipos que turnos-por-semana, igual asigna todos los slots (repetir es inevitable pero no se traba)", async () => {
    const { monthCycle } = await setupMonthWithTeams({ year: 2094, month: 4, teamCount: 2 });

    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(gen.status).toBe(200);

    // Ningún slot que cuenta al balance se queda sin la cantidad de equipos
    // que necesita, ni siquiera cuando repetir es matemáticamente inevitable.
    const fixedSlots = gen.body.slots.filter((s) => s.slotType === "FIXED");
    for (const slot of fixedSlots) {
      expect(slot.teams).toHaveLength(slot.teamsNeeded);
    }

    const schedule = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    const counts = schedule.body.balance.map((b) => b.count);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    expect(max - min).toBeLessThanOrEqual(1);
  });
});

describe("GET /api/months/:id/schedule", () => {
  it("slots: [] y balance: [] si todavía no se generó el horario", async () => {
    const { monthCycle } = await setupMonthWithTeams({ year: 2094, month: 5, teamCount: 1 });
    const res = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([]);
    expect(res.body.balance).toEqual([]);
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).get("/api/months/no-existe-este-id/schedule"));
    expect(res.status).toBe(404);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).get("/api/months/cualquier-id/schedule");
    expect(res.status).toBe(401);
  });
});

describe("Interacción con generate-teams (Fase 3): re-sortear borra el horario", () => {
  it("re-sortear un mes CON horario generado lo borra y devuelve HORARIO_BORRADO_POR_RESORTEO", async () => {
    const { monthCycle } = await setupMonthWithTeams({
      year: 2094,
      month: 1,
      teamCount: 2,
      instructors: 4,
      ministros: 4,
    });

    const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
    expect(gen.status).toBe(200);
    expect(gen.body.slots.length).toBeGreaterThan(0);

    const resort = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`));
    expect(resort.status).toBe(200);
    expect(resort.body.warnings.some((w) => w.code === "HORARIO_BORRADO_POR_RESORTEO")).toBe(true);

    const schedule = await authed(request(app).get(`/api/months/${monthCycle.id}/schedule`));
    expect(schedule.body.slots).toEqual([]);
  });

  it("re-sortear un mes SIN horario no genera ningún warning HORARIO_BORRADO_POR_RESORTEO", async () => {
    const { monthCycle } = await setupMonthWithTeams({ year: 2094, month: 2, teamCount: 2 });

    const resort = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`));
    expect(resort.status).toBe(200);
    expect(resort.body.warnings.some((w) => w.code === "HORARIO_BORRADO_POR_RESORTEO")).toBe(false);
  });
});

async function retirePeople(people) {
  await prisma.person.updateMany({ where: { id: { in: people.map((p) => p.id) } }, data: { active: false } });
}
