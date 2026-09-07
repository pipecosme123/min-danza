// Fase 9 · Reportes de asistencia por líderes.
// Contrato: docs/architecture/phase9-attendance-reports-contract.md §3-5, §7.
// Golpea la base Postgres real de desarrollo (mismo patrón que
// phase4c-post-publish-edits.test.js). Aísla los INSTRUCTOR/MINISTRO activos
// preexistentes durante la corrida (el pool de sorteo es global).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { currentCivilDate } from "../src/utils/dates.js";
import { ensureLeaderAccounts } from "../src/services/leaderAccounts.service.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA F9";
const DOC_PREFIX = `QAF9${RUN_ID}`;
let docCounter = 0;

let adminToken;
const createdPersonIds = [];
const createdMonthCycleIds = [];
let preExistingActiveIds = [];

const TZ = process.env.APP_TIMEZONE || "America/Bogota";

function civilStr(offsetDays = 0) {
  const today = currentCivilDate(TZ);
  const d = new Date(Date.UTC(today.year, today.month - 1, today.day + offsetDays));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

beforeAll(async () => {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: REAL_USERNAME, password: REAL_PASSWORD });
  adminToken = res.body.token;

  const preExisting = await prisma.person.findMany({
    where: { active: true, category: { in: ["INSTRUCTOR", "MINISTRO"] } },
    select: { id: true },
  });
  preExistingActiveIds = preExisting.map((p) => p.id);
  if (preExistingActiveIds.length > 0) {
    await prisma.person.updateMany({
      where: { id: { in: preExistingActiveIds } },
      data: { active: false },
    });
  }
});

afterAll(async () => {
  await prisma.attendanceReport.deleteMany({ where: { monthCycleId: { in: createdMonthCycleIds } } });
  await prisma.slotAssignment.deleteMany({ where: { monthCycleId: { in: createdMonthCycleIds } } });
  await prisma.serviceSlot.deleteMany({ where: { monthCycleId: { in: createdMonthCycleIds } } });
  await prisma.teamMember.deleteMany({
    where: { OR: [{ personId: { in: createdPersonIds } }, { monthCycleId: { in: createdMonthCycleIds } }] },
  });
  await prisma.team.deleteMany({ where: { monthCycleId: { in: createdMonthCycleIds } } });
  await prisma.monthCycle.deleteMany({ where: { id: { in: createdMonthCycleIds } } });
  await prisma.leaderAccount.deleteMany({
    where: {
      OR: [
        { personId: { in: createdPersonIds } },
        { person: { fullName: { startsWith: NAME_PREFIX } } },
      ],
    },
  });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.person.deleteMany({ where: { fullName: { startsWith: NAME_PREFIX } } });

  if (preExistingActiveIds.length > 0) {
    await prisma.person.updateMany({
      where: { id: { in: preExistingActiveIds } },
      data: { active: true },
    });
  }
  await prisma.$disconnect();
});

function authed(req) {
  return req.set("Authorization", `Bearer ${adminToken}`);
}
function asLeader(req, token) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function makePerson(category, suffix, extra = {}) {
  docCounter += 1;
  const person = await prisma.person.create({
    data: {
      fullName: `${NAME_PREFIX} ${suffix}`,
      documentId: `${DOC_PREFIX}${docCounter}`,
      category,
      active: true,
      ...extra,
    },
  });
  createdPersonIds.push(person.id);
  return person;
}

/**
 * Crea un mes con equipos + horario, lo finaliza a mano y provisiona las
 * cuentas de líder. Devuelve el mes, sus equipos y las cuentas nuevas.
 */
async function setupFinalizedMonth({ year, month, teamCount = 2 }) {
  // Aísla el pool de sorteo de ESTE mes: desactiva a las personas creadas por
  // setups anteriores para que sus líderes no se repitan entre meses (si se
  // repitieran, `ensureLeaderAccounts` no volvería a devolver su cuenta).
  if (createdPersonIds.length > 0) {
    await prisma.person.updateMany({ where: { id: { in: createdPersonIds } }, data: { active: false } });
  }
  const instructors = teamCount + 1;
  const ministros = teamCount * 2;
  await Promise.all(
    Array.from({ length: instructors }, (_, i) => makePerson("INSTRUCTOR", `${year}.${month} Instr ${i + 1}`))
  );
  await Promise.all(
    Array.from({ length: ministros }, (_, i) => makePerson("MINISTRO", `${year}.${month} Min ${i + 1}`))
  );

  const createRes = await authed(request(app).post("/api/months")).send({ year, month, teamCount });
  expect(createRes.status).toBe(201);
  const monthCycle = createRes.body;
  createdMonthCycleIds.push(monthCycle.id);

  const gen = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-teams`)).send({});
  expect(gen.status).toBe(200);

  const sched = await authed(request(app).post(`/api/months/${monthCycle.id}/generate-schedule`));
  expect(sched.status).toBe(200);

  await prisma.monthCycle.update({
    where: { id: monthCycle.id },
    data: { status: "FINALIZED", finalizedAt: new Date() },
  });
  const { newLeaderAccounts } = await ensureLeaderAccounts(monthCycle.id);

  return { monthCycle, teams: gen.body.teams, slots: sched.body.slots, newLeaderAccounts };
}

/** Mueve un slot a una fecha civil dada y hora 00:00 (ventana abierta si es hoy/ayer). */
async function rescheduleSlot(slotId, civilDate, startTime = "00:00") {
  await prisma.serviceSlot.update({
    where: { id: slotId },
    data: { date: new Date(`${civilDate}T00:00:00.000Z`), startTime },
  });
}

async function loginLeader(username, password) {
  const res = await request(app).post("/api/leader/login").send({ username, password });
  return res;
}

const _leaderTokenCache = new Map();

/**
 * Login + cambio de la contraseña temporal; devuelve un token ya "usable"
 * (el mismo JWT sigue valiendo tras el cambio, porque el gate lee
 * `mustChangePassword` de la base, no del token). Cacheado por username para
 * no gastar el `leaderLoginLimiter` en corridas grandes.
 */
async function activatedLeaderToken(account) {
  if (_leaderTokenCache.has(account.username)) return _leaderTokenCache.get(account.username);
  const login = await loginLeader(account.username, account.tempPassword);
  expect(login.status).toBe(200);
  expect(login.body.mustChangePassword).toBe(true);
  const cp = await asLeader(
    request(app).post("/api/leader/change-password"),
    login.body.token
  ).send({ currentPassword: account.tempPassword, newPassword: `Nueva-${RUN_ID}-x` });
  expect(cp.status).toBe(200);
  _leaderTokenCache.set(account.username, login.body.token);
  return login.body.token;
}

// ---------------------------------------------------------------------------

describe("Fase 9 · autenticación del portal de líderes", () => {
  let accounts;
  let leaderToken;

  beforeAll(async () => {
    const setup = await setupFinalizedMonth({ year: 2097, month: 1, teamCount: 2 });
    accounts = setup.newLeaderAccounts;
    expect(accounts.length).toBe(2);
    leaderToken = await activatedLeaderToken(accounts[0]);
  });

  it("credenciales incorrectas devuelven 401 con mensaje genérico", async () => {
    const res = await loginLeader(accounts[0].username, "no-es-la-clave");
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/incorrect/i);
  });

  it("mientras mustChangePassword sea true, /services está bloqueado (403)", async () => {
    const login = await loginLeader(accounts[1].username, accounts[1].tempPassword);
    const res = await asLeader(request(app).get("/api/leader/services"), login.body.token);
    expect(res.status).toBe(403);
  });

  it("un token de líder NO sirve para una ruta administrativa", async () => {
    const res = await asLeader(request(app).get("/api/people"), leaderToken);
    expect(res.status).toBe(401);
  });

  it("un token de admin NO sirve para el portal de líderes", async () => {
    const res = await authed(request(app).get("/api/leader/services"));
    expect(res.status).toBe(401);
  });

  it("GET /api/leader/me devuelve el perfil del líder", async () => {
    const res = await asLeader(request(app).get("/api/leader/me"), leaderToken);
    expect(res.status).toBe(200);
    expect(res.body.fullName).toContain(NAME_PREFIX);
    expect(res.body.mustChangePassword).toBe(false);
  });
});

describe("Fase 9 · provisionamiento e idempotencia", () => {
  it("finalizar un mes crea una LeaderAccount por líder; re-provisionar no duplica", async () => {
    const { monthCycle, newLeaderAccounts } = await setupFinalizedMonth({
      year: 2097,
      month: 2,
      teamCount: 3,
    });
    expect(newLeaderAccounts.length).toBe(3);
    for (const acc of newLeaderAccounts) {
      expect(acc.username).toBeTruthy();
      expect(acc.tempPassword).toHaveLength(12);
    }
    const again = await ensureLeaderAccounts(monthCycle.id);
    expect(again.newLeaderAccounts).toHaveLength(0);
  });
});

describe("Fase 9 · ciclo de vida de un reporte", () => {
  let ctx;
  let leaderToken;
  let leaderTeamId;
  let openSlotId;
  let reportId;

  beforeAll(async () => {
    ctx = await setupFinalizedMonth({ year: 2097, month: 3, teamCount: 2 });
    // El líder de la cuenta[0] -> su equipo.
    const account = ctx.newLeaderAccounts[0];
    const membership = await prisma.teamMember.findFirst({
      where: { personId: account.personId, role: "LEADER" },
      select: { teamId: true },
    });
    leaderTeamId = membership.teamId;
    // Un slot asignado a ese equipo, reprogramado a hoy (ventana abierta).
    const assignment = await prisma.slotAssignment.findFirst({
      where: { teamId: leaderTeamId },
      select: { serviceSlotId: true },
    });
    openSlotId = assignment.serviceSlotId;
    await rescheduleSlot(openSlotId, civilStr(0));
    leaderToken = await activatedLeaderToken(account);
  });

  it("GET /services lista el turno con la ventana ABIERTA y sin reporte", async () => {
    const res = await asLeader(request(app).get("/api/leader/services"), leaderToken);
    expect(res.status).toBe(200);
    const svc = res.body.services.find((s) => s.slotId === openSlotId && s.teamId === leaderTeamId);
    expect(svc).toBeTruthy();
    expect(svc.window.state).toBe("ABIERTA");
    expect(svc.report).toBeNull();
  });

  it("POST crea el borrador con una entry por integrante (status null)", async () => {
    const res = await asLeader(
      request(app).post(`/api/leader/services/${openSlotId}/${leaderTeamId}/report`),
      leaderToken
    );
    expect(res.status).toBe(201);
    reportId = res.body.report.id;
    expect(res.body.report.status).toBe("DRAFT");
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(res.body.entries.every((e) => e.status === null)).toBe(true);
    // El líder va primero.
    expect(res.body.entries[0].role).toBe("LEADER");
  });

  it("crear un segundo reporte para el mismo (turno, equipo) da 409", async () => {
    const res = await asLeader(
      request(app).post(`/api/leader/services/${openSlotId}/${leaderTeamId}/report`),
      leaderToken
    );
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("REPORTE_YA_EXISTE");
  });

  it("enviar con integrantes sin marcar devuelve 409 REPORTE_INCOMPLETO", async () => {
    const res = await asLeader(
      request(app).post(`/api/leader/reports/${reportId}/submit`),
      leaderToken
    );
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("REPORTE_INCOMPLETO");
    expect(res.body.error.details.pending.length).toBeGreaterThan(0);
  });

  it("guardar el borrador con todos marcados y luego enviar funciona", async () => {
    const current = await asLeader(request(app).get(`/api/leader/reports/${reportId}`), leaderToken);
    const entries = current.body.entries.map((e) => ({ personId: e.personId, status: "ASISTIO" }));
    const save = await asLeader(
      request(app).patch(`/api/leader/reports/${reportId}`),
      leaderToken
    ).send({ entries, generalNotes: "Todo en orden." });
    expect(save.status).toBe(200);

    const submit = await asLeader(
      request(app).post(`/api/leader/reports/${reportId}/submit`),
      leaderToken
    );
    expect(submit.status).toBe(200);
    expect(submit.body.report.status).toBe("SUBMITTED");
  });

  it("el líder puede reabrir su reporte enviado mientras la ventana siga abierta", async () => {
    const res = await asLeader(
      request(app).post(`/api/leader/reports/${reportId}/reopen`),
      leaderToken
    );
    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe("DRAFT");
  });

  it("con la ventana cerrada, no se puede editar ni reabrir; el admin sí puede reabrir", async () => {
    // Reenviar y luego cerrar la ventana moviendo el slot al pasado.
    const current = await asLeader(request(app).get(`/api/leader/reports/${reportId}`), leaderToken);
    const entries = current.body.entries.map((e) => ({ personId: e.personId, status: "ASISTIO" }));
    await asLeader(request(app).patch(`/api/leader/reports/${reportId}`), leaderToken).send({ entries });
    await asLeader(request(app).post(`/api/leader/reports/${reportId}/submit`), leaderToken);

    await rescheduleSlot(openSlotId, civilStr(-10));

    const reopen = await asLeader(
      request(app).post(`/api/leader/reports/${reportId}/reopen`),
      leaderToken
    );
    expect(reopen.status).toBe(409);
    expect(reopen.body.error.details.code).toBe("VENTANA_CERRADA");

    const adminReopen = await authed(
      request(app).post(`/api/attendance/reports/${reportId}/reopen`)
    );
    expect(adminReopen.status).toBe(200);
    expect(adminReopen.body.status).toBe("DRAFT");

    // Aun reabierto por el admin, el líder no puede editar (ventana cerrada).
    const save = await asLeader(
      request(app).patch(`/api/leader/reports/${reportId}`),
      leaderToken
    ).send({ generalNotes: "tarde" });
    expect(save.status).toBe(409);
  });
});

describe("Fase 9 · autorización entre líderes", () => {
  it("un líder no puede leer el reporte de un equipo que no lidera (403)", async () => {
    const ctx = await setupFinalizedMonth({ year: 2097, month: 4, teamCount: 2 });
    const [a, b] = ctx.newLeaderAccounts;

    const teamOfB = await prisma.teamMember.findFirst({
      where: { personId: b.personId, role: "LEADER" },
      select: { teamId: true },
    });
    const slotOfB = await prisma.slotAssignment.findFirst({
      where: { teamId: teamOfB.teamId },
      select: { serviceSlotId: true },
    });
    await rescheduleSlot(slotOfB.serviceSlotId, civilStr(0));

    const tokenB = await activatedLeaderToken(b);
    const created = await asLeader(
      request(app).post(`/api/leader/services/${slotOfB.serviceSlotId}/${teamOfB.teamId}/report`),
      tokenB
    );
    expect(created.status).toBe(201);

    const tokenA = await activatedLeaderToken(a);
    const res = await asLeader(
      request(app).get(`/api/leader/reports/${created.body.report.id}`),
      tokenA
    );
    expect(res.status).toBe(403);
  });
});

describe("Fase 9 · reglas de remplazo / cambio / apoyo", () => {
  let ctx;
  let leaderToken;
  let teamId;
  let slotId;
  let reportId;
  let memberIds;
  let externalPerson;

  beforeAll(async () => {
    ctx = await setupFinalizedMonth({ year: 2097, month: 5, teamCount: 2 });
    const account = ctx.newLeaderAccounts[0];
    const membership = await prisma.teamMember.findFirst({
      where: { personId: account.personId, role: "LEADER" },
      select: { teamId: true },
    });
    teamId = membership.teamId;
    const assignment = await prisma.slotAssignment.findFirst({
      where: { teamId },
      select: { serviceSlotId: true },
    });
    slotId = assignment.serviceSlotId;
    await rescheduleSlot(slotId, civilStr(-1));
    leaderToken = await activatedLeaderToken(account);

    const created = await asLeader(
      request(app).post(`/api/leader/services/${slotId}/${teamId}/report`),
      leaderToken
    );
    reportId = created.body.report.id;
    memberIds = created.body.entries.map((e) => e.personId);
    externalPerson = await makePerson("MINISTRO", "Externo Cubridor");
  });

  it("REMPLAZADO sin coveredByPersonId es rechazado", async () => {
    const entries = memberIds.map((id, i) => ({
      personId: id,
      status: i === 1 ? "REMPLAZADO" : "ASISTIO",
    }));
    const res = await asLeader(
      request(app).patch(`/api/leader/reports/${reportId}`),
      leaderToken
    ).send({ entries });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("FALTA_QUIEN_CUBRIO");
  });

  it("coveredBy no puede ser un integrante del propio equipo", async () => {
    const entries = memberIds.map((id, i) => ({
      personId: id,
      status: i === 1 ? "CAMBIO" : "ASISTIO",
      coveredByPersonId: i === 1 ? memberIds[2] : undefined,
    }));
    const res = await asLeader(
      request(app).patch(`/api/leader/reports/${reportId}`),
      leaderToken
    ).send({ entries });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("CUBRIO_ES_INTEGRANTE");
  });

  it("REMPLAZADO con persona externa activa se guarda y NO altera el roster del equipo", async () => {
    const saBefore = await prisma.slotAssignment.count({ where: { serviceSlotId: slotId } });
    const entries = memberIds.map((id, i) => ({
      personId: id,
      status: i === 1 ? "REMPLAZADO" : "ASISTIO",
      coveredByPersonId: i === 1 ? externalPerson.id : undefined,
    }));
    const ok = await asLeader(
      request(app).patch(`/api/leader/reports/${reportId}`),
      leaderToken
    ).send({ entries });
    expect(ok.status).toBe(200);
    const covered = ok.body.entries.find((e) => e.status === "REMPLAZADO");
    expect(covered.coveredByFullName).toBe(externalPerson.fullName);

    expect(await prisma.teamMember.count({ where: { teamId, personId: externalPerson.id } })).toBe(0);
    expect(await prisma.slotAssignment.count({ where: { serviceSlotId: slotId } })).toBe(saBefore);
  });
});

describe("Fase 9 · texto para WhatsApp", () => {
  it("líder primero, resto alfabético, 'cubrió:', 'No asistieron:' y 'Apoyos:'", async () => {
    const ctx = await setupFinalizedMonth({ year: 2097, month: 6, teamCount: 2 });
    const account = ctx.newLeaderAccounts[0];
    const membership = await prisma.teamMember.findFirst({
      where: { personId: account.personId, role: "LEADER" },
      select: { teamId: true },
    });
    const teamId = membership.teamId;
    const assignment = await prisma.slotAssignment.findFirst({
      where: { teamId },
      select: { serviceSlotId: true },
    });
    const slotId = assignment.serviceSlotId;
    await rescheduleSlot(slotId, civilStr(-1), "08:00");
    const token = await activatedLeaderToken(account);

    const created = await asLeader(
      request(app).post(`/api/leader/services/${slotId}/${teamId}/report`),
      token
    );
    const reportId = created.body.report.id;
    const members = created.body.entries; // ya viene ordenado: líder primero

    const cover = await makePerson("MINISTRO", "Cubre WA");
    const support = await makePerson("MINISTRO", "Apoya WA");

    const entries = members.map((e, i) => {
      if (i === 0) return { personId: e.personId, status: "ASISTIO" }; // líder
      if (i === 1) return { personId: e.personId, status: "REMPLAZADO", coveredByPersonId: cover.id };
      if (i === 2) return { personId: e.personId, status: "NO_ASISTIO_CON_EXCUSA" };
      return { personId: e.personId, status: "ASISTIO" };
    });
    await asLeader(request(app).patch(`/api/leader/reports/${reportId}`), token).send({
      entries,
      supports: [{ personId: support.id }],
    });
    await asLeader(request(app).post(`/api/leader/reports/${reportId}/submit`), token);

    const wa = await asLeader(
      request(app).get(`/api/leader/reports/${reportId}/whatsapp-text`),
      token
    );
    expect(wa.status).toBe(200);
    const text = wa.body.text;
    expect(text).toContain("Asistencia — ");
    expect(text).toMatch(/1\. QA F9/); // líder en la posición 1
    expect(text).toContain("cubrió: QA F9 Cubre WA");
    expect(text).toContain("No asistieron:");
    expect(text).toContain("Apoyos:");
    expect(text).toContain("QA F9 Apoya WA");
    // La persona con excusa NO aparece en la lista numerada.
    const numberedBlock = text.split("No asistieron:")[0];
    expect(numberedBlock).not.toContain(members[2].fullName);
  });
});

describe("Fase 9 · vistas del admin", () => {
  let ctx;
  let reportId;
  let monthId;

  beforeAll(async () => {
    ctx = await setupFinalizedMonth({ year: 2097, month: 7, teamCount: 2 });
    monthId = ctx.monthCycle.id;
    const account = ctx.newLeaderAccounts[0];
    const membership = await prisma.teamMember.findFirst({
      where: { personId: account.personId, role: "LEADER" },
      select: { teamId: true },
    });
    const teamId = membership.teamId;
    const assignment = await prisma.slotAssignment.findFirst({
      where: { teamId },
      select: { serviceSlotId: true },
    });
    await rescheduleSlot(assignment.serviceSlotId, civilStr(0));
    const token = await activatedLeaderToken(account);
    const created = await asLeader(
      request(app).post(`/api/leader/services/${assignment.serviceSlotId}/${teamId}/report`),
      token
    );
    reportId = created.body.report.id;
    const entries = created.body.entries.map((e) => ({ personId: e.personId, status: "ASISTIO" }));
    await asLeader(request(app).patch(`/api/leader/reports/${reportId}`), token).send({ entries });
  });

  it("GET /months/:id/attendance lista la matriz sin contenido de borradores", async () => {
    const res = await authed(request(app).get(`/api/months/${monthId}/attendance`));
    expect(res.status).toBe(200);
    const row = res.body.items.find((i) => i.reportId === reportId);
    expect(row.status).toBe("BORRADOR");
    expect(row.entries).toBeUndefined();
  });

  it("el admin NO puede ver el contenido de un borrador (409 REPORTE_EN_BORRADOR)", async () => {
    const res = await authed(request(app).get(`/api/attendance/reports/${reportId}`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("REPORTE_EN_BORRADOR");
  });

  it("una vez enviado, el admin lo ve, lo edita y queda marcado lastEditedByAdmin", async () => {
    // El líder envía.
    const account = ctx.newLeaderAccounts[0];
    const token = await activatedLeaderToken(account);
    const submit = await asLeader(request(app).post(`/api/leader/reports/${reportId}/submit`), token);
    expect(submit.status).toBe(200);

    const view = await authed(request(app).get(`/api/attendance/reports/${reportId}`));
    expect(view.status).toBe(200);
    expect(view.body.report.status).toBe("SUBMITTED");

    const edit = await authed(request(app).patch(`/api/attendance/reports/${reportId}`)).send({
      generalNotes: "Ajuste del admin.",
    });
    expect(edit.status).toBe(200);
    expect(edit.body.report.lastEditedByAdmin).toBe(true);
  });
});

describe("Fase 9 · guarda en reasignación de turno", () => {
  it("no se puede reasignar a mano un turno que ya tiene reporte para ese equipo", async () => {
    const ctx = await setupFinalizedMonth({ year: 2097, month: 8, teamCount: 3 });
    const account = ctx.newLeaderAccounts[0];
    const membership = await prisma.teamMember.findFirst({
      where: { personId: account.personId, role: "LEADER" },
      select: { teamId: true },
    });
    const teamId = membership.teamId;
    const assignment = await prisma.slotAssignment.findFirst({
      where: { teamId, serviceSlot: { slotType: "FIXED" } },
      select: { id: true, serviceSlotId: true },
    });
    await rescheduleSlot(assignment.serviceSlotId, civilStr(0));
    const token = await activatedLeaderToken(account);
    await asLeader(
      request(app).post(`/api/leader/services/${assignment.serviceSlotId}/${teamId}/report`),
      token
    );

    const otherTeam = await prisma.team.findFirst({
      where: { monthCycleId: ctx.monthCycle.id, teamType: "REGULAR", id: { not: teamId } },
      select: { id: true },
    });
    const res = await authed(request(app).patch(`/api/assignments/${assignment.id}`)).send({
      teamId: otherTeam.id,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("ASIGNACION_CON_REPORTE");
  });
});
