// CRUD de /api/people (list/create/update/delete). Contrato completo en
// docs/architecture/phase2-people-contract.md. Golpea la base Postgres real
// de desarrollo (igual que auth.test.js); todo lo creado por este archivo
// se limpia en afterAll vía borrado físico directo con Prisma (no hay
// TeamMember/SpecialSaturdayMember reales todavía salvo los que el propio
// test de purge crea y también limpia).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA CRUD";
const DOC_PREFIX = `QACRUD${RUN_ID}`;
let docCounter = 0;
function uniqueDoc() {
  docCounter += 1;
  return `${DOC_PREFIX}${docCounter}`;
}

let token;
const createdPersonIds = [];
const createdMonthCycleIds = [];

beforeAll(async () => {
  const res = await request(app).post("/api/auth/login").send({ username: REAL_USERNAME, password: REAL_PASSWORD });
  token = res.body.token;
});

afterAll(async () => {
  // Limpieza en orden por FK: TeamMember -> Team -> MonthCycle -> Person.
  await prisma.teamMember.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.team.deleteMany({ where: { monthCycleId: { in: createdMonthCycleIds } } });
  await prisma.monthCycle.deleteMany({ where: { id: { in: createdMonthCycleIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  // Red de seguridad adicional por si algún test dejó algo huérfano con el prefijo.
  await prisma.person.deleteMany({ where: { fullName: { startsWith: NAME_PREFIX } } });
  await prisma.$disconnect();
});

function authed(req) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function createPersonDirect(overrides = {}) {
  const res = await authed(request(app).post("/api/people")).send({
    fullName: `${NAME_PREFIX} ${overrides.suffix ?? "Base"}`,
    category: "MINISTRO",
    documentId: uniqueDoc(),
    ...overrides,
  });
  expect(res.status).toBe(201);
  createdPersonIds.push(res.body.id);
  return res.body;
}

describe("POST /api/people", () => {
  it("crea una persona nueva (201) y normaliza el documento", async () => {
    const res = await authed(request(app).post("/api/people")).send({
      fullName: `  ${NAME_PREFIX}   Documento   Normalizado  `,
      documentId: "1.234.567",
      category: "INSTRUCTOR",
    });

    expect(res.status).toBe(201);
    expect(res.body.fullName).toBe(`${NAME_PREFIX} Documento Normalizado`);
    expect(res.body.documentId).toBe("1234567");
    expect(res.body.active).toBe(true);
    expect(res.body.notes).toBeNull();
    createdPersonIds.push(res.body.id);
  });

  it("'1.234.567' y '1234567' colisionan en el índice único (409 DOCUMENTO_DUPLICADO)", async () => {
    const res = await authed(request(app).post("/api/people")).send({
      fullName: `${NAME_PREFIX} Colision Documento`,
      documentId: "1234567",
      category: "MINISTRO",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("DOCUMENTO_DUPLICADO");
    expect(res.body.error.details.personId).toBeTruthy();
  });

  it("carrera: dos altas concurrentes con el mismo documento nuevo no deben producir un 409 genérico sin `details.code` (el check previo no está serializado)", async () => {
    const doc = uniqueDoc();
    const [resA, resB] = await Promise.all([
      authed(request(app).post("/api/people")).send({
        fullName: `${NAME_PREFIX} Carrera A`,
        documentId: doc,
        category: "MINISTRO",
      }),
      authed(request(app).post("/api/people")).send({
        fullName: `${NAME_PREFIX} Carrera B`,
        documentId: doc,
        category: "MINISTRO",
      }),
    ]);

    const results = [resA, resB];
    const created = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);

    expect(created.length).toBe(1);
    expect(conflicted.length).toBe(1);
    expect(conflicted[0].body.error.details?.code).toBe("DOCUMENTO_DUPLICADO");
    expect(conflicted[0].body.error.details?.personId).toBe(created[0].body.id);

    createdPersonIds.push(created[0].body.id);
  });

  it("nombre duplicado sin confirmar devuelve 409, y con confirmDuplicateName crea (201)", async () => {
    const first = await createPersonDirect({ suffix: "Homonimo", fullName: `${NAME_PREFIX} Homonimo` });
    expect(first.fullName).toBe(`${NAME_PREFIX} Homonimo`);

    const dup = await authed(request(app).post("/api/people")).send({
      fullName: `${NAME_PREFIX} Homonimo`,
      category: "MINISTRO",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.code).toBe("NOMBRE_DUPLICADO");
    expect(dup.body.error.details.personId).toBe(first.id);

    const confirmed = await authed(request(app).post("/api/people")).send({
      fullName: `${NAME_PREFIX} Homonimo`,
      category: "MINISTRO",
      confirmDuplicateName: true,
    });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.id).not.toBe(first.id);
    createdPersonIds.push(confirmed.body.id);
  });

  it("body inválido (nombre con dígitos) devuelve 400 de validación", async () => {
    const res = await authed(request(app).post("/api/people")).send({
      fullName: "Persona123",
      category: "MINISTRO",
    });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app)
      .post("/api/people")
      .send({ fullName: `${NAME_PREFIX} Sin Token`, category: "MINISTRO" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/people", () => {
  it("lista, pagina y filtra por categoría/búsqueda", async () => {
    await createPersonDirect({ suffix: "Buscable Uno", fullName: `${NAME_PREFIX} Buscable Uno`, category: "INSTRUCTOR" });
    await createPersonDirect({ suffix: "Buscable Dos", fullName: `${NAME_PREFIX} Buscable Dos`, category: "MINISTRO" });

    const res = await authed(request(app).get(`/api/people?search=${encodeURIComponent(`${NAME_PREFIX} Buscable`)}`));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 25 });

    const filtered = await authed(
      request(app).get(`/api/people?search=${encodeURIComponent(`${NAME_PREFIX} Buscable`)}&category=INSTRUCTOR`)
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.every((p) => p.category === "INSTRUCTOR")).toBe(true);
  });

  it("página fuera de rango devuelve data: [] (no 404)", async () => {
    const res = await authed(request(app).get("/api/people?page=9999&pageSize=5"));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("query inválida (page=0) devuelve 400", async () => {
    const res = await authed(request(app).get("/api/people?page=0"));
    expect(res.status).toBe(400);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).get("/api/people");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/people/:id", () => {
  it("body vacío devuelve 400 SIN_CAMBIOS", async () => {
    const person = await createPersonDirect({ suffix: "Patch Vacio" });
    const res = await authed(request(app).patch(`/api/people/${person.id}`)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("SIN_CAMBIOS");
  });

  it("actualiza campos y devuelve { person, warnings }", async () => {
    const person = await createPersonDirect({ suffix: "Patch Ok" });
    const res = await authed(request(app).patch(`/api/people/${person.id}`)).send({ notes: "actualizado" });
    expect(res.status).toBe(200);
    expect(res.body.person.notes).toBe("actualizado");
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it("cambiar el documento a uno ya usado por otra persona devuelve 409 DOCUMENTO_DUPLICADO", async () => {
    const personA = await createPersonDirect({ suffix: "Patch Doc A" });
    const personB = await createPersonDirect({ suffix: "Patch Doc B" });

    const res = await authed(request(app).patch(`/api/people/${personB.id}`)).send({ documentId: personA.documentId });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("DOCUMENTO_DUPLICADO");
  });

  it("documentId '' se guarda como null (no rompe el índice único)", async () => {
    const personA = await createPersonDirect({ suffix: "Doc Vacio A" });
    const personB = await createPersonDirect({ suffix: "Doc Vacio B" });

    const clearA = await authed(request(app).patch(`/api/people/${personA.id}`)).send({ documentId: "" });
    expect(clearA.status).toBe(200);
    expect(clearA.body.person.documentId).toBeNull();

    const clearB = await authed(request(app).patch(`/api/people/${personB.id}`)).send({ documentId: "" });
    expect(clearB.status).toBe(200);
    expect(clearB.body.person.documentId).toBeNull();
  });

  it("id inexistente devuelve 404", async () => {
    const res = await authed(request(app).patch("/api/people/no-existe-este-id")).send({ notes: "x" });
    expect(res.status).toBe(404);
  });

  it("P19: dar de baja a alguien en un mes DRAFT/FINALIZED devuelve warning PERSONA_EN_EQUIPO_ACTIVO", async () => {
    const person = await createPersonDirect({ suffix: "Baja Con Equipo Activo" });
    const monthCycle = await prisma.monthCycle.create({
      data: { year: 2098, month: 3, teamCount: 1, status: "DRAFT" },
    });
    createdMonthCycleIds.push(monthCycle.id);
    const team = await prisma.team.create({
      data: { monthCycleId: monthCycle.id, label: "Equipo 1", orderIndex: 1 },
    });
    await prisma.teamMember.create({
      data: { teamId: team.id, monthCycleId: monthCycle.id, personId: person.id, role: "COLLABORATOR" },
    });

    const res = await authed(request(app).patch(`/api/people/${person.id}`)).send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.person.active).toBe(false);
    expect(res.body.warnings.some((w) => w.code === "PERSONA_EN_EQUIPO_ACTIVO")).toBe(true);
  });

  it("P16: degradar INSTRUCTOR -> MINISTRO a alguien que lidera un equipo marca manualOverride y devuelve warning", async () => {
    const person = await createPersonDirect({ suffix: "Lider A Degradar", category: "INSTRUCTOR" });
    const monthCycle = await prisma.monthCycle.create({
      data: { year: 2098, month: 4, teamCount: 1, status: "DRAFT" },
    });
    createdMonthCycleIds.push(monthCycle.id);
    const team = await prisma.team.create({
      data: { monthCycleId: monthCycle.id, label: "Equipo 1", orderIndex: 1 },
    });
    const member = await prisma.teamMember.create({
      data: { teamId: team.id, monthCycleId: monthCycle.id, personId: person.id, role: "LEADER" },
    });
    expect(member.manualOverride).toBe(false);

    const res = await authed(request(app).patch(`/api/people/${person.id}`)).send({ category: "MINISTRO" });
    expect(res.status).toBe(200);
    expect(res.body.person.category).toBe("MINISTRO");
    expect(res.body.warnings.some((w) => w.code === "LIDER_DEGRADADO_A_MINISTRO")).toBe(true);

    const reloaded = await prisma.teamMember.findUnique({ where: { id: member.id } });
    expect(reloaded.manualOverride).toBe(true);
  });
});

describe("DELETE /api/people/:id", () => {
  it("baja lógica por defecto (200) y es idempotente", async () => {
    const person = await createPersonDirect({ suffix: "Baja Logica" });

    const first = await authed(request(app).delete(`/api/people/${person.id}`));
    expect(first.status).toBe(200);
    expect(first.body.person.active).toBe(false);

    const second = await authed(request(app).delete(`/api/people/${person.id}`));
    expect(second.status).toBe(200);
    expect(second.body.person.active).toBe(false);
  });

  it("id inexistente devuelve 404", async () => {
    const res = await authed(request(app).delete("/api/people/no-existe-este-id"));
    expect(res.status).toBe(404);
  });

  it("?purge=true sin historial borra físicamente (200 { deleted: true })", async () => {
    const person = await createPersonDirect({ suffix: "Purge Limpio" });
    const res = await authed(request(app).delete(`/api/people/${person.id}?purge=true`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, id: person.id });

    const stillThere = createdPersonIds.indexOf(person.id);
    if (stillThere !== -1) createdPersonIds.splice(stillThere, 1); // ya no existe, no reintentar en el cleanup

    const check = await prisma.person.findUnique({ where: { id: person.id } });
    expect(check).toBeNull();
  });

  it("?purge=true con historial devuelve 409 PERSONA_CON_HISTORIAL", async () => {
    const person = await createPersonDirect({ suffix: "Purge Con Historial" });
    const monthCycle = await prisma.monthCycle.create({
      data: { year: 2098, month: 5, teamCount: 1, status: "DRAFT" },
    });
    createdMonthCycleIds.push(monthCycle.id);
    const team = await prisma.team.create({
      data: { monthCycleId: monthCycle.id, label: "Equipo 1", orderIndex: 1 },
    });
    await prisma.teamMember.create({
      data: { teamId: team.id, monthCycleId: monthCycle.id, personId: person.id, role: "COLLABORATOR" },
    });

    const res = await authed(request(app).delete(`/api/people/${person.id}?purge=true`));
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("PERSONA_CON_HISTORIAL");
    expect(res.body.error.details.teamMemberships).toBe(1);

    // La persona sigue existiendo (no se borró nada).
    const check = await prisma.person.findUnique({ where: { id: person.id } });
    expect(check).not.toBeNull();
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).delete("/api/people/cualquier-id");
    expect(res.status).toBe(401);
  });
});
