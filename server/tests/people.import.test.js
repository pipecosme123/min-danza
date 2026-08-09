// POST /api/people/import — carga masiva CSV/XLSX. Contrato completo en
// docs/architecture/phase2-people-contract.md (secciones 1-3, P1-P14).
// Golpea la base Postgres real de desarrollo; limpia todo lo que crea.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const REAL_USERNAME = process.env.ADMIN_USERNAME || "admin";
const REAL_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe_DevOnly123!";

const RUN_ID = Date.now().toString().slice(-6);
const NAME_PREFIX = "QA Import";
const DOC_PREFIX = `QAIMP${RUN_ID}`;

let token;

beforeAll(async () => {
  const res = await request(app).post("/api/auth/login").send({ username: REAL_USERNAME, password: REAL_PASSWORD });
  token = res.body.token;
});

afterAll(async () => {
  await prisma.person.deleteMany({ where: { fullName: { startsWith: NAME_PREFIX } } });
  await prisma.person.deleteMany({ where: { documentId: { startsWith: DOC_PREFIX } } });
  await prisma.$disconnect();
});

function authedPost(path) {
  return request(app).post(path).set("Authorization", `Bearer ${token}`);
}

function attachCsv(req, content, filename = "import.csv") {
  return req.attach("file", Buffer.from(content, "utf8"), filename);
}

async function buildXlsxBuffer(rows, sheetName = "Personas") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  rows.forEach((row) => sheet.addRow(row));
  return workbook.xlsx.writeBuffer();
}

describe("POST /api/people/import — archivo mixto (creados/actualizados/omitidos/fallidos)", () => {
  it("created + updated + skipped + failed === totalRows, y cada rama produce el código esperado", async () => {
    const docExisteActiva = `${DOC_PREFIX}EXIST1`;
    const docExisteInactiva = `${DOC_PREFIX}EXIST2`;
    const docSinCambios = `${DOC_PREFIX}NOCHANGE`;
    const docNuevo = `${DOC_PREFIX}NEW1`;

    const existingActive = await prisma.person.create({
      data: { fullName: `${NAME_PREFIX} Existente Activa`, documentId: docExisteActiva, category: "MINISTRO" },
    });
    const existingInactive = await prisma.person.create({
      data: {
        fullName: `${NAME_PREFIX} Existente Inactiva`,
        documentId: docExisteInactiva,
        category: "MINISTRO",
        active: false,
      },
    });
    const existingSameNameNoDoc = await prisma.person.create({
      data: { fullName: `${NAME_PREFIX} Nombre Sin Documento`, category: "MINISTRO" },
    });
    const existingNoChange = await prisma.person.create({
      data: { fullName: `${NAME_PREFIX} Sin Cambios`, documentId: docSinCambios, category: "MINISTRO" },
    });

    const csv = [
      "Nombre,Categoria,Documento",
      `${NAME_PREFIX} Nueva Persona Uno,Elegible Lider,${docNuevo}`,
      `${NAME_PREFIX} Nueva Persona Dos,Colaborador,`,
      `${NAME_PREFIX} Nueva Persona Dos,Colaborador,`, // duplicado intra-archivo por nombre
      `${NAME_PREFIX} Categoria Mala,categoria-que-no-existe,`,
      `${NAME_PREFIX} Existente Activa,Elegible Lider,${docExisteActiva}`, // updated
      `${NAME_PREFIX} Intento Reactivar,Colaborador,${docExisteInactiva}`, // PERSONA_INACTIVA
      `${NAME_PREFIX} Nombre Sin Documento,Colaborador,`, // NOMBRE_DUPLICADO_EN_BD
      `${NAME_PREFIX} Sin Cambios,Colaborador,${docSinCambios}`, // SIN_CAMBIOS
      ",,", // fila completamente vacía -> blankRowsIgnored
    ].join("\n");

    const res = await attachCsv(authedPost("/api/people/import"), csv);

    expect(res.status).toBe(200);
    const { summary } = res.body;
    expect(summary.created + summary.updated + summary.skipped + summary.failed).toBe(summary.totalRows);
    expect(summary.totalRows).toBe(8);
    expect(summary.created).toBe(2);
    expect(summary.updated).toBe(1);
    expect(summary.skipped).toBe(4);
    expect(summary.failed).toBe(1);
    expect(summary.blankRowsIgnored).toBe(1);

    const skipCodes = res.body.skipped.map((s) => s.code).sort();
    expect(skipCodes).toEqual(
      ["DUPLICADO_EN_ARCHIVO_NOMBRE", "NOMBRE_DUPLICADO_EN_BD", "PERSONA_INACTIVA", "SIN_CAMBIOS"].sort()
    );

    expect(res.body.errors[0].code).toBe("CATEGORIA_INVALIDA");

    const updatedEntry = res.body.updated[0];
    expect(updatedEntry.personId).toBe(existingActive.id);
    expect(updatedEntry.changes.category).toEqual({ from: "MINISTRO", to: "INSTRUCTOR" });

    const reactivateAttempt = res.body.skipped.find((s) => s.code === "PERSONA_INACTIVA");
    expect(reactivateAttempt.personId).toBe(existingInactive.id);

    const nameCollision = res.body.skipped.find((s) => s.code === "NOMBRE_DUPLICADO_EN_BD");
    expect(nameCollision.personId).toBe(existingSameNameNoDoc.id);

    const noChange = res.body.skipped.find((s) => s.code === "SIN_CAMBIOS");
    expect(noChange.personId).toBe(existingNoChange.id);

    // Confirma que la actualización realmente se escribió en la base.
    const reloaded = await prisma.person.findUnique({ where: { id: existingActive.id } });
    expect(reloaded.category).toBe("INSTRUCTOR");

    // La persona inactiva NO se reactivó (P11).
    const reloadedInactive = await prisma.person.findUnique({ where: { id: existingInactive.id } });
    expect(reloadedInactive.active).toBe(false);
  });
});

describe("POST /api/people/import — formatos de archivo", () => {
  it("CSV delimitado por ';' (Excel en español) se autodetecta", async () => {
    const csv = [
      "Nombre;Categoria;Documento",
      `${NAME_PREFIX} Semicolon Uno;Colaborador;${DOC_PREFIX}SEMI1`,
    ].join("\n");

    const res = await attachCsv(authedPost("/api/people/import"), csv, "semicolon.csv");
    expect(res.status).toBe(200);
    expect(res.body.summary.created).toBe(1);
    expect(res.body.created[0].fullName).toBe(`${NAME_PREFIX} Semicolon Uno`);
  });

  it("CSV con BOM UTF-8 se parsea sin corromper el encabezado", async () => {
    const csv =
      "﻿" + ["Nombre,Categoria,Documento", `${NAME_PREFIX} Bom Uno,Colaborador,${DOC_PREFIX}BOM1`].join("\n");

    const res = await attachCsv(authedPost("/api/people/import"), csv, "bom.csv");
    expect(res.status).toBe(200);
    expect(res.body.summary.created).toBe(1);
    expect(res.body.summary.failed).toBe(0);
  });

  it("XLSX (hoja 'Personas') se procesa igual que CSV", async () => {
    const buffer = await buildXlsxBuffer([
      ["Nombre Completo", "Categoría", "Documento"],
      [`${NAME_PREFIX} Xlsx Uno`, "Apoyo", `${DOC_PREFIX}XLSX1`],
    ]);

    const res = await authedPost("/api/people/import")
      .attach("file", buffer, { filename: "import.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

    expect(res.status).toBe(200);
    expect(res.body.summary.created).toBe(1);
    expect(res.body.created[0].category).toBe("MINISTRO"); // alias "Apoyo" -> MINISTRO (P5)
  });

  it("A1: celda de categoría vacía (columna presente pero sin valor) es error de fila, NUNCA se asigna MINISTRO por defecto", async () => {
    const csv = [
      "Nombre,Categoria,Documento",
      `${NAME_PREFIX} Categoria Vacia,,${DOC_PREFIX}CATVACIA`,
    ].join("\n");

    const res = await attachCsv(authedPost("/api/people/import"), csv, "categoria-vacia.csv");
    expect(res.status).toBe(200);
    expect(res.body.summary.created).toBe(0);
    expect(res.body.summary.failed).toBe(1);
    expect(res.body.errors[0].code).toBe("CATEGORIA_VACIA");

    // Confirma también contra la base: no se creó a nadie con esta fila
    // (ni con MINISTRO ni con ninguna otra categoría inferida).
    const created = await prisma.person.findUnique({ where: { documentId: `${DOC_PREFIX}CATVACIA` } });
    expect(created).toBeNull();
  });

  it("falta la columna obligatoria 'categoria' => 400 COLUMNA_REQUERIDA_FALTANTE", async () => {
    const csv = ["Nombre,Telefono", `${NAME_PREFIX} Sin Categoria,555-0000`].join("\n");

    const res = await attachCsv(authedPost("/api/people/import"), csv, "missing-col.csv");
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("COLUMNA_REQUERIDA_FALTANTE");
  });

  it("encabezado ambiguo (dos columnas para el mismo campo) => 400 ENCABEZADO_AMBIGUO", async () => {
    const csv = ["Nombre,Nombres,Categoria", "A,B,Colaborador"].join("\n");
    const res = await attachCsv(authedPost("/api/people/import"), csv, "ambiguous.csv");
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("ENCABEZADO_AMBIGUO");
  });

  it("columnas desconocidas se ignoran y se listan en summary.ignoredColumns", async () => {
    const csv = [
      "Nombre,Categoria,Telefono",
      `${NAME_PREFIX} Columna Ignorada,Colaborador,555-1111`,
    ].join("\n");
    const res = await attachCsv(authedPost("/api/people/import"), csv, "ignored.csv");
    expect(res.status).toBe(200);
    expect(res.body.summary.ignoredColumns).toContain("Telefono");
  });

  it("columna opcional 'Joven' mapea sí/no a isJoven (crea y actualiza)", async () => {
    const docSi = `${DOC_PREFIX}JOVENSI`;
    const docNo = `${DOC_PREFIX}JOVENNO`;
    const docVacio = `${DOC_PREFIX}JOVENVACIO`;
    const docUpdate = `${DOC_PREFIX}JOVENUPD`;

    const existing = await prisma.person.create({
      data: { fullName: `${NAME_PREFIX} Joven Update`, documentId: docUpdate, category: "MINISTRO", isJoven: false },
    });

    const csv = [
      "Nombre,Categoria,Documento,Joven",
      `${NAME_PREFIX} Joven Si,Colaborador,${docSi},Sí`,
      `${NAME_PREFIX} Joven No,Colaborador,${docNo},No`,
      `${NAME_PREFIX} Joven Vacio,Colaborador,${docVacio},`,
      `${NAME_PREFIX} Joven Update,Colaborador,${docUpdate},true`,
    ].join("\n");

    const res = await attachCsv(authedPost("/api/people/import"), csv, "joven.csv");
    expect(res.status).toBe(200);
    expect(res.body.summary.created).toBe(3);
    expect(res.body.summary.updated).toBe(1);

    const created = await prisma.person.findMany({
      where: { documentId: { in: [docSi, docNo, docVacio] } },
    });
    const bySi = created.find((p) => p.documentId === docSi);
    const byNo = created.find((p) => p.documentId === docNo);
    const byVacio = created.find((p) => p.documentId === docVacio);
    expect(bySi.isJoven).toBe(true);
    expect(byNo.isJoven).toBe(false);
    expect(byVacio.isJoven).toBe(false);

    const reloadedExisting = await prisma.person.findUnique({ where: { id: existing.id } });
    expect(reloadedExisting.isJoven).toBe(true);
    expect(res.body.updated[0].changes.isJoven).toEqual({ from: false, to: true });
  });

  it("sin la columna 'Joven' en el archivo, isJoven queda false para todas las filas creadas", async () => {
    const doc = `${DOC_PREFIX}SINCOLJOVEN`;
    const csv = ["Nombre,Categoria,Documento", `${NAME_PREFIX} Sin Columna Joven,Colaborador,${doc}`].join("\n");

    const res = await attachCsv(authedPost("/api/people/import"), csv, "sin-joven.csv");
    expect(res.status).toBe(200);
    expect(res.body.summary.created).toBe(1);

    const created = await prisma.person.findUnique({ where: { documentId: doc } });
    expect(created.isJoven).toBe(false);
  });

  it("CSV guardado como Windows-1252/latin1 (sin BOM) se detecta y decodifica bien (tildes/ñ no se corrompen)", async () => {
    const doc = `${DOC_PREFIX}LATIN1`;
    // Construido directamente como bytes latin1 -- así es como Excel en
    // español guarda un CSV "ANSI" (sin BOM UTF-8). Si se decodificara como
    // UTF-8 a secas, cada tilde/ñ se corrompería a "�" y la fila fallaría
    // con NOMBRE_CARACTERES_INVALIDOS en vez de crear a la persona.
    const csvText = [
      "Nombre,Categoria,Documento",
      `${NAME_PREFIX} José Muñoz Peña,Colaborador,${doc}`,
    ].join("\n");
    const latin1Buffer = Buffer.from(csvText, "latin1");

    const res = await authedPost("/api/people/import").attach("file", latin1Buffer, "latin1.csv");

    expect(res.status).toBe(200);
    expect(res.body.summary.failed).toBe(0);
    expect(res.body.summary.created).toBe(1);
    expect(res.body.created[0].fullName).toBe(`${NAME_PREFIX} José Muñoz Peña`);

    const created = await prisma.person.findUnique({ where: { documentId: doc } });
    expect(created).not.toBeNull();
    expect(created.fullName).toBe(`${NAME_PREFIX} José Muñoz Peña`);
    expect(created.fullName).not.toContain("�");
  });

  it("archivo .xls legacy se rechaza con mensaje explícito", async () => {
    const res = await authedPost("/api/people/import").attach("file", Buffer.from("contenido"), "legacy.xls");
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("FORMATO_NO_SOPORTADO");
    expect(res.body.error.message).toMatch(/\.xlsx.*\.csv|\.csv.*\.xlsx/i);
  });

  it("más de 2000 filas de datos => 400 DEMASIADAS_FILAS", async () => {
    const lines = ["Nombre,Categoria"];
    for (let i = 0; i < 2001; i += 1) {
      lines.push("Fila De Prueba,Colaborador");
    }
    const res = await attachCsv(authedPost("/api/people/import"), lines.join("\n"), "too-many.csv");
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe("DEMASIADAS_FILAS");
  });

  it("archivo > 2MB => 413 ARCHIVO_MUY_GRANDE", async () => {
    const filler = "x".repeat(3 * 1024 * 1024); // 3MB de relleno en una sola celda de notas
    const csv = ["Nombre,Categoria,Notas", `${NAME_PREFIX} Archivo Grande,Colaborador,${filler}`].join("\n");
    const res = await attachCsv(authedPost("/api/people/import"), csv, "huge.csv");
    expect(res.status).toBe(413);
    expect(res.body.error.details.code).toBe("ARCHIVO_MUY_GRANDE");
  });

  it("sin token devuelve 401", async () => {
    const res = await request(app)
      .post("/api/people/import")
      .attach("file", Buffer.from("Nombre,Categoria\nA,Colaborador"), "no-auth.csv");
    expect(res.status).toBe(401);
  });
});
