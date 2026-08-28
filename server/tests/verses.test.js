// GET/POST /api/months/:id/verses, PATCH/DELETE /api/verses/:verseId
// ("versículo del mes", Parte 4 wise-noodling-hickey.md) y su inclusión en
// GET /api/schedule/:year/:month (página pública). Golpea la base Postgres
// real de desarrollo (mismo patrón que events.test.js). Sin dependencia de
// red: bibleSource.service.js#fetchVerseText se mockea completo (mismo
// patrón de bibleSource.test.js, que ya prueba el parser real por separado).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

const { fetchVerseTextMock } = vi.hoisted(() => ({ fetchVerseTextMock: vi.fn() }));
vi.mock("../src/services/bibleSource.service.js", () => ({ fetchVerseText: fetchVerseTextMock }));

import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { ValidationError } from "../src/utils/errors.js";
import { currentCivilDate } from "../src/utils/dates.js";
import { env } from "../src/config/env.js";

const app = createApp();

// Mismo patrón que tests/publicSchedule.test.js: un mes FIJO en el futuro
// (ej. 2088) ya no sirve para probar la lectura pública desde la Parte 3
// (wise-noodling-hickey.md) -- un mes estrictamente futuro solo se revela en
// los últimos 8 días del mes siguiente. Se usa un offset (5) relativo a hoy,
// distinto de los que ya usa publicSchedule.test.js, para no colisionar.
function monthsAgo(n) {
  const today = currentCivilDate(env.APP_TIMEZONE);
  const totalMonths = today.year * 12 + (today.month - 1) - n;
  return { year: Math.floor(totalMonths / 12), month: (totalMonths % 12) + 1 };
}

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

let token;
const createdMonthCycleIds = [];

beforeAll(async () => {
  const res = await request(app).post("/api/auth/login").send({ username: REAL_USERNAME, password: REAL_PASSWORD });
  token = res.body.token;
});

afterAll(async () => {
  await prisma.versePassage.deleteMany({ where: { monthCycleId: { in: createdMonthCycleIds } } });
  await prisma.monthCycle.deleteMany({ where: { id: { in: createdMonthCycleIds } } });
  await prisma.$disconnect();
});

function authed(req) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function createMonth(year, month) {
  const res = await authed(request(app).post("/api/months")).send({ year, month, teamCount: 1 });
  expect(res.status).toBe(201);
  createdMonthCycleIds.push(res.body.id);
  return res.body;
}

beforeAll(() => {
  fetchVerseTextMock.mockImplementation(async ({ book, chapter, verses }) => ({
    text: `Texto simulado de ${book} ${chapter}:${verses}.`,
    reference: `${book} ${chapter}:${verses} (RVR1960)`,
  }));
});

describe("GET /api/months/:id/verses", () => {
  it("lista vacía en un mes recién creado", async () => {
    const month = await createMonth(2088, 1);
    const res = await authed(request(app).get(`/api/months/${month.id}/verses`));
    expect(res.status).toBe(200);
    expect(res.body.verses).toEqual([]);
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).get("/api/months/no-existe-este-id/verses"));
    expect(res.status).toBe(404);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).get("/api/months/cualquier-id/verses");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/months/:id/verses", () => {
  it("agrega un versículo, resuelve el texto vía bibleSource y lo persiste", async () => {
    const month = await createMonth(2088, 2);
    const res = await authed(request(app).post(`/api/months/${month.id}/verses`)).send({
      book: "Juan",
      chapter: 3,
      verses: "16-18",
    });
    expect(res.status).toBe(201);
    expect(res.body.verse).toMatchObject({
      book: "Juan",
      chapter: 3,
      verses: "16-18",
      version: "RVR1960",
      text: "Texto simulado de Juan 3:16-18.",
      reference: "Juan 3:16-18 (RVR1960)",
    });
    expect(fetchVerseTextMock).toHaveBeenCalledWith({ book: "Juan", chapter: 3, verses: "16-18" });

    const list = await authed(request(app).get(`/api/months/${month.id}/verses`));
    expect(list.body.verses).toHaveLength(1);
    expect(list.body.verses[0].id).toBe(res.body.verse.id);
  });

  it("permite agregar más de un versículo al mismo mes, en orden de creación", async () => {
    const month = await createMonth(2088, 3);
    const first = await authed(request(app).post(`/api/months/${month.id}/verses`)).send({
      book: "Salmos",
      chapter: 23,
      verses: "1",
    });
    expect(first.status).toBe(201);
    const second = await authed(request(app).post(`/api/months/${month.id}/verses`)).send({
      book: "Filipenses",
      chapter: 4,
      verses: "13",
    });
    expect(second.status).toBe(201);

    const list = await authed(request(app).get(`/api/months/${month.id}/verses`));
    expect(list.body.verses.map((v) => v.id)).toEqual([first.body.verse.id, second.body.verse.id]);
  });

  it("400 VERSICULO_NO_ENCONTRADO cuando bibleSource no encuentra la referencia", async () => {
    fetchVerseTextMock.mockImplementationOnce(async () => {
      throw new ValidationError("No se encontró ese pasaje bíblico.", { code: "VERSICULO_NO_ENCONTRADO" });
    });

    const month = await createMonth(2088, 4);
    const res = await authed(request(app).post(`/api/months/${month.id}/verses`)).send({
      book: "Juan",
      chapter: 99,
      verses: "99",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("VERSICULO_NO_ENCONTRADO");

    const list = await authed(request(app).get(`/api/months/${month.id}/verses`));
    expect(list.body.verses).toEqual([]);
  });

  it("404 si el mes no existe", async () => {
    const res = await authed(request(app).post("/api/months/no-existe-este-id/verses")).send({
      book: "Juan",
      chapter: 3,
      verses: "16",
    });
    expect(res.status).toBe(404);
  });

  it("409 MES_PASADO si el mes ya está FINALIZED y ya pasó", async () => {
    const month = await createMonth(2017, 1);
    await prisma.monthCycle.update({ where: { id: month.id }, data: { status: "FINALIZED" } });

    const res = await authed(request(app).post(`/api/months/${month.id}/verses`)).send({
      book: "Juan",
      chapter: 3,
      verses: "16",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.code).toBe("MES_PASADO");
  });

  it("400 si el body no cumple el formato esperado", async () => {
    const month = await createMonth(2088, 5);
    const res = await authed(request(app).post(`/api/months/${month.id}/verses`)).send({
      book: "Juan",
      chapter: 3,
      verses: "dieciseis", // no matchea el regex de verses
    });
    expect(res.status).toBe(400);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).post("/api/months/cualquier-id/verses").send({});
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/verses/:verseId", () => {
  it("vuelve a resolver el texto cuando cambia book/chapter/verses", async () => {
    const month = await createMonth(2088, 6);
    const created = await authed(request(app).post(`/api/months/${month.id}/verses`)).send({
      book: "Juan",
      chapter: 3,
      verses: "16",
    });
    expect(created.status).toBe(201);

    const res = await authed(request(app).patch(`/api/verses/${created.body.verse.id}`)).send({
      verses: "16-18",
    });
    expect(res.status).toBe(200);
    expect(res.body.verse).toMatchObject({
      book: "Juan",
      chapter: 3,
      verses: "16-18",
      text: "Texto simulado de Juan 3:16-18.",
      reference: "Juan 3:16-18 (RVR1960)",
    });
    expect(fetchVerseTextMock).toHaveBeenLastCalledWith({ book: "Juan", chapter: 3, verses: "16-18" });
  });

  it("404 VERSICULO_NO_ENCONTRADO si el id no existe", async () => {
    const res = await authed(request(app).patch("/api/verses/no-existe-este-id")).send({ verses: "1" });
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("VERSICULO_NO_ENCONTRADO");
  });

  it("400 si el body está vacío", async () => {
    const month = await createMonth(2088, 7);
    const created = await authed(request(app).post(`/api/months/${month.id}/verses`)).send({
      book: "Juan",
      chapter: 3,
      verses: "16",
    });
    expect(created.status).toBe(201);

    const res = await authed(request(app).patch(`/api/verses/${created.body.verse.id}`)).send({});
    expect(res.status).toBe(400);
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).patch("/api/verses/cualquier-id").send({ verses: "1" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/verses/:verseId", () => {
  it("borra el versículo", async () => {
    const month = await createMonth(2088, 8);
    const created = await authed(request(app).post(`/api/months/${month.id}/verses`)).send({
      book: "Juan",
      chapter: 3,
      verses: "16",
    });
    expect(created.status).toBe(201);

    const res = await authed(request(app).delete(`/api/verses/${created.body.verse.id}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });

    const list = await authed(request(app).get(`/api/months/${month.id}/verses`));
    expect(list.body.verses).toEqual([]);
  });

  it("404 VERSICULO_NO_ENCONTRADO si el id no existe", async () => {
    const res = await authed(request(app).delete("/api/verses/no-existe-este-id"));
    expect(res.status).toBe(404);
    expect(res.body.error.details.code).toBe("VERSICULO_NO_ENCONTRADO");
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app).delete("/api/verses/cualquier-id");
    expect(res.status).toBe(401);
  });
});

describe("Los versículos del mes aparecen en la página pública", () => {
  it("GET /api/schedule/:year/:month incluye verses[] con el texto ya resuelto", async () => {
    const target = monthsAgo(5);
    const month = await createMonth(target.year, target.month);
    const created = await authed(request(app).post(`/api/months/${month.id}/verses`)).send({
      book: "Filipenses",
      chapter: 4,
      verses: "13",
    });
    expect(created.status).toBe(201);

    await prisma.monthCycle.update({ where: { id: month.id }, data: { status: "FINALIZED" } });

    const res = await request(app).get(`/api/schedule/${month.year}/${month.month}`);
    expect(res.status).toBe(200);
    expect(res.body.verses).toHaveLength(1);
    expect(res.body.verses[0]).toMatchObject({
      reference: "Filipenses 4:13 (RVR1960)",
      text: "Texto simulado de Filipenses 4:13.",
      version: "RVR1960",
    });
  });
});
