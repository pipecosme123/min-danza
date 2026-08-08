// Carga masiva de personas (CSV/XLSX). Ver
// docs/architecture/phase2-people-contract.md secciones 1-3 (P1-P14) para
// el contrato completo. El router (routes/people.routes.js) solo recibe el
// archivo vía multer y llama a `importPeopleFromFile`; toda la lógica de
// parseo/validación/deduplicación/escritura vive acá.

import Papa from "papaparse";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma.js";
import { ValidationError } from "../utils/errors.js";
import { normalizeName, nameKey, normalizeDocument } from "../utils/normalize.js";

const MAX_DATA_ROWS = 2000;
const DETAIL_LIMIT = 200;
const WRITE_CHUNK_SIZE = 500;
const TRANSACTION_TIMEOUT_MS = 30000;

const FULLNAME_REGEX = /^\p{L}[\p{L}\p{M}\s'.-]*$/u;
const DOCUMENT_REGEX = /^[A-Z0-9]+$/;

// ---------------------------------------------------------------------------
// P4 — alias de columnas. El matching se hace comparando encabezados YA
// normalizados con normalizeHeader() contra esta tabla (también normalizada
// al construir el índice), así que da igual si un alias de esta lista trae
// o no tilde/guion.
// ---------------------------------------------------------------------------
const CANONICAL_ALIASES = {
  fullName: [
    "nombre completo",
    "nombre",
    "nombres",
    "nombre y apellido",
    "nombres y apellidos",
    "full name",
    "fullname",
  ],
  category: ["categoria", "categoría", "tipo", "rol", "category"],
  documentId: [
    "documento",
    "documento de identidad",
    "cedula",
    "cédula",
    "identificacion",
    "identificación",
    "cc",
    "document",
    "documentid",
  ],
  notes: ["notas", "observaciones", "comentarios", "notes"],
};

// P5 — tabla CERRADA de valores aceptados en la columna de categoría.
const CATEGORY_TABLE = {
  "ELEGIBLE LIDER": "ELEGIBLE_LIDER",
  ELEGIBLE: "ELEGIBLE_LIDER",
  "ELEGIBLE A LIDER": "ELEGIBLE_LIDER",
  LIDER: "ELEGIBLE_LIDER",
  LIDERES: "ELEGIBLE_LIDER",
  "ELEGIBLE PARA LIDER": "ELEGIBLE_LIDER",
  COLABORADOR: "COLABORADOR",
  COLABORADORA: "COLABORADOR",
  COLABORADORES: "COLABORADOR",
  COLAB: "COLABORADOR",
  APOYO: "COLABORADOR",
};

function normalizeHeader(s) {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function normalizeCategoryCell(s) {
  return s
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

const ALIAS_LOOKUP = (() => {
  const map = new Map();
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    for (const alias of aliases) {
      map.set(normalizeHeader(alias), canonical);
    }
  }
  return map;
})();

function getExtension(filename) {
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return "";
  return filename.slice(idx).toLowerCase();
}

// ---------------------------------------------------------------------------
// Parseo de archivo -> tabla cruda { headerRow, dataRows, blankRowsIgnored }
// Unifica CSV y XLSX en la misma forma para que el resto del pipeline no
// sepa de dónde vino el archivo.
// ---------------------------------------------------------------------------

function isBlankRow(cells) {
  return cells.every((c) => c == null || String(c).trim() === "");
}

function buildTableFromRows(rows) {
  let headerIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (!isBlankRow(rows[i].cells)) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new ValidationError("El archivo está vacío.", { code: "ARCHIVO_VACIO" });
  }

  const headerRow = rows[headerIndex].cells;
  const rest = rows.slice(headerIndex + 1);

  let blankRowsIgnored = 0;
  const dataRows = [];
  for (const row of rest) {
    if (isBlankRow(row.cells)) {
      blankRowsIgnored += 1;
      continue;
    }
    dataRows.push(row);
  }

  if (dataRows.length === 0) {
    throw new ValidationError("El archivo no tiene filas de datos.", { code: "SIN_FILAS_DE_DATOS" });
  }
  if (dataRows.length > MAX_DATA_ROWS) {
    throw new ValidationError(`El archivo supera el máximo de ${MAX_DATA_ROWS} filas de datos.`, {
      code: "DEMASIADAS_FILAS",
    });
  }

  return { headerRow, dataRows, blankRowsIgnored };
}

function parseCsvBuffer(buffer) {
  let text = buffer.toString("utf8");
  // BOM UTF-8: papaparse no lo retira solo cuando se le pasa un string.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // delimiter: "" => autodetección entre , ; \t | (P3: Excel en español
  // exporta con ";").
  const parsed = Papa.parse(text, { delimiter: "", skipEmptyLines: false });

  const rows = parsed.data.map((cells, index) => ({
    rowNumber: index + 1,
    cells: Array.isArray(cells) ? cells.map((c) => (c == null ? "" : String(c))) : [String(cells ?? "")],
  }));

  return buildTableFromRows(rows);
}

function cellToString(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (typeof v.text === "string") return v.text;
    if (v.result !== undefined && v.result !== null) return String(v.result);
    return "";
  }
  return String(v);
}

async function parseXlsxBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  if (workbook.worksheets.length === 0) {
    throw new ValidationError("El archivo no tiene ninguna hoja.", { code: "ARCHIVO_VACIO" });
  }

  // P3: hoja "Personas" si existe, si no la primera.
  const sheet =
    workbook.worksheets.find((ws) => normalizeHeader(ws.name) === "personas") ?? workbook.worksheets[0];

  const rows = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const width = Math.max(row.cellCount, sheet.columnCount || 0);
    const cells = [];
    for (let c = 1; c <= width; c += 1) {
      cells.push(cellToString(row.getCell(c)));
    }
    rows.push({ rowNumber, cells });
  });

  return buildTableFromRows(rows);
}

// ---------------------------------------------------------------------------
// Resolución de columnas (P4).
// ---------------------------------------------------------------------------

function resolveColumns(headerRow) {
  const assigned = {};
  const headerTextByCanonical = {};
  const ignoredColumns = [];
  const ambiguous = new Set();

  headerRow.forEach((raw, index) => {
    const text = (raw ?? "").toString();
    if (text.trim() === "") return;
    const norm = normalizeHeader(text);
    const canonical = ALIAS_LOOKUP.get(norm);
    if (!canonical) {
      ignoredColumns.push(text.trim());
      return;
    }
    if (assigned[canonical] !== undefined) {
      ambiguous.add(canonical);
      return;
    }
    assigned[canonical] = index;
    headerTextByCanonical[canonical] = text.trim();
  });

  if (ambiguous.size > 0) {
    throw new ValidationError("El archivo tiene más de una columna para el mismo campo.", {
      code: "ENCABEZADO_AMBIGUO",
      fields: [...ambiguous],
    });
  }

  const missing = [];
  if (assigned.fullName === undefined) missing.push("fullName");
  if (assigned.category === undefined) missing.push("category");
  if (missing.length > 0) {
    throw new ValidationError("Falta una columna obligatoria en el archivo (nombre y/o categoría).", {
      code: "COLUMNA_REQUERIDA_FALTANTE",
      missing,
    });
  }

  return { assigned, headerTextByCanonical, ignoredColumns };
}

// ---------------------------------------------------------------------------
// Validación de celda por celda. Las mismas reglas (longitud, regex) que
// los esquemas zod de people.routes.js — ver P8: un dato válido por un
// camino debe serlo por el otro.
// ---------------------------------------------------------------------------

function validateFullNameCell(raw) {
  if (raw.trim() === "") {
    return { ok: false, code: "NOMBRE_VACIO", message: "El nombre no puede estar vacío." };
  }
  const value = normalizeName(raw);
  if (value.length < 3) {
    return { ok: false, code: "NOMBRE_MUY_CORTO", message: "El nombre debe tener al menos 3 caracteres." };
  }
  if (value.length > 120) {
    return { ok: false, code: "NOMBRE_MUY_LARGO", message: "El nombre no puede superar 120 caracteres." };
  }
  if (!FULLNAME_REGEX.test(value)) {
    return {
      ok: false,
      code: "NOMBRE_CARACTERES_INVALIDOS",
      message: "El nombre solo admite letras, espacios, apóstrofos, guiones y puntos.",
    };
  }
  return { ok: true, value };
}

function validateCategoryCell(raw) {
  if (raw.trim() === "") {
    return { ok: false, code: "CATEGORIA_VACIA", message: "La categoría no puede estar vacía." };
  }
  const norm = normalizeCategoryCell(raw);
  const mapped = CATEGORY_TABLE[norm];
  if (!mapped) {
    return {
      ok: false,
      code: "CATEGORIA_INVALIDA",
      message: `«${raw.trim()}» no es una categoría válida. Usa «Elegible líder» o «Colaborador».`,
    };
  }
  return { ok: true, value: mapped };
}

function validateDocumentCell(raw) {
  const value = normalizeDocument(raw);
  if (value.length < 3) {
    return { ok: false, code: "DOCUMENTO_INVALIDO", message: "El documento debe tener al menos 3 caracteres." };
  }
  if (value.length > 30) {
    return { ok: false, code: "DOCUMENTO_MUY_LARGO", message: "El documento no puede superar 30 caracteres." };
  }
  if (!DOCUMENT_REGEX.test(value)) {
    return { ok: false, code: "DOCUMENTO_INVALIDO", message: "El documento solo admite letras y números." };
  }
  return { ok: true, value };
}

function validateNotesCell(raw) {
  const value = raw.trim();
  if (value.length > 500) {
    return { ok: false, code: "NOTAS_MUY_LARGAS", message: "Las notas no pueden superar 500 caracteres." };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Orquestación principal.
// ---------------------------------------------------------------------------

/**
 * @param {{ buffer: Buffer, originalName: string }} file
 */
export async function importPeopleFromFile({ buffer, originalName }) {
  const ext = getExtension(originalName || "");
  let table;
  if (ext === ".csv") {
    table = parseCsvBuffer(buffer);
  } else if (ext === ".xlsx") {
    table = await parseXlsxBuffer(buffer);
  } else if (ext === ".xls") {
    throw new ValidationError("El formato .xls no es compatible. Guarda el archivo como .xlsx o .csv.", {
      code: "FORMATO_NO_SOPORTADO",
    });
  } else {
    throw new ValidationError("Formato de archivo no soportado. Usa .csv o .xlsx.", {
      code: "FORMATO_NO_SOPORTADO",
    });
  }

  const { headerRow, dataRows, blankRowsIgnored } = table;
  const { assigned, headerTextByCanonical, ignoredColumns } = resolveColumns(headerRow);

  const getCell = (row, canonical) => {
    const idx = assigned[canonical];
    if (idx === undefined) return undefined;
    const raw = row.cells[idx];
    return raw == null ? "" : String(raw);
  };

  // ---- Pasada 1: validar cada fila + deduplicar DENTRO del archivo (P7-P10) ----
  const errors = [];
  const skipped = [];
  const validRows = [];
  const fileKeyMap = new Map(); // "document:XXX" | "name:XXX" -> rowNumber ganador

  for (const row of dataRows) {
    const rowNumber = row.rowNumber;

    const rawFullName = getCell(row, "fullName") ?? "";
    const nameResult = validateFullNameCell(rawFullName);
    if (!nameResult.ok) {
      errors.push({
        row: rowNumber,
        column: headerTextByCanonical.fullName,
        value: rawFullName,
        code: nameResult.code,
        message: nameResult.message,
      });
      continue;
    }

    const rawCategory = getCell(row, "category") ?? "";
    const categoryResult = validateCategoryCell(rawCategory);
    if (!categoryResult.ok) {
      errors.push({
        row: rowNumber,
        column: headerTextByCanonical.category,
        value: rawCategory,
        code: categoryResult.code,
        message: categoryResult.message,
      });
      continue;
    }

    let documentId = null;
    if (assigned.documentId !== undefined) {
      const rawDoc = getCell(row, "documentId") ?? "";
      if (rawDoc.trim() !== "") {
        const docResult = validateDocumentCell(rawDoc);
        if (!docResult.ok) {
          errors.push({
            row: rowNumber,
            column: headerTextByCanonical.documentId,
            value: rawDoc,
            code: docResult.code,
            message: docResult.message,
          });
          continue;
        }
        documentId = docResult.value;
      }
    }

    let notes = null;
    let notesProvided = false;
    if (assigned.notes !== undefined) {
      const rawNotes = getCell(row, "notes") ?? "";
      if (rawNotes.trim() !== "") {
        const notesResult = validateNotesCell(rawNotes);
        if (!notesResult.ok) {
          errors.push({
            row: rowNumber,
            column: headerTextByCanonical.notes,
            value: rawNotes,
            code: notesResult.code,
            message: notesResult.message,
          });
          continue;
        }
        notes = notesResult.value;
        notesProvided = true;
      }
    }

    const fullName = nameResult.value;
    const category = categoryResult.value;

    // P9: clave natural = documento normalizado si vino, si no nameKey.
    const keyKind = documentId ? "document" : "name";
    const keyValue = documentId ?? nameKey(fullName);
    const dedupKey = `${keyKind}:${keyValue}`;

    const winnerRow = fileKeyMap.get(dedupKey);
    if (winnerRow !== undefined) {
      // P10: gana la primera aparición.
      if (keyKind === "document") {
        skipped.push({
          row: rowNumber,
          code: "DUPLICADO_EN_ARCHIVO_DOCUMENTO",
          personId: null,
          message: `El documento ${documentId} ya aparece en la fila ${winnerRow} de este archivo.`,
        });
      } else {
        skipped.push({
          row: rowNumber,
          code: "DUPLICADO_EN_ARCHIVO_NOMBRE",
          personId: null,
          message: `El nombre «${fullName}» ya aparece en la fila ${winnerRow} de este archivo.`,
        });
      }
      continue;
    }
    fileKeyMap.set(dedupKey, rowNumber);

    validRows.push({ rowNumber, fullName, category, documentId, notes, notesProvided });
  }

  // ---- Pasada 2: resolver contra la base (P11) ----
  const docCandidates = [...new Set(validRows.filter((r) => r.documentId).map((r) => r.documentId))];
  const existingByDoc =
    docCandidates.length > 0 ? await prisma.person.findMany({ where: { documentId: { in: docCandidates } } }) : [];
  const existingByDocMap = new Map(existingByDoc.map((p) => [p.documentId, p]));

  const needsNameLookup = validRows.some((r) => !r.documentId);
  const existingByNameMap = new Map();
  if (needsNameLookup) {
    const allPeople = await prisma.person.findMany({ select: { id: true, fullName: true, active: true } });
    for (const person of allPeople) {
      const key = nameKey(person.fullName);
      if (!existingByNameMap.has(key)) existingByNameMap.set(key, person);
    }
  }

  const pendingOps = [];

  for (const row of validRows) {
    if (row.documentId) {
      const existing = existingByDocMap.get(row.documentId);
      if (existing) {
        if (!existing.active) {
          skipped.push({
            row: row.rowNumber,
            code: "PERSONA_INACTIVA",
            personId: existing.id,
            message: `Ya existe una persona INACTIVA con este documento (${existing.fullName}). No se reactivó automáticamente; usa "Reactivar" si corresponde.`,
          });
          continue;
        }

        const changes = {};
        if (row.fullName && row.fullName !== existing.fullName) {
          changes.fullName = { from: existing.fullName, to: row.fullName };
        }
        if (row.category !== existing.category) {
          changes.category = { from: existing.category, to: row.category };
        }
        if (row.notesProvided && row.notes !== existing.notes) {
          changes.notes = { from: existing.notes, to: row.notes };
        }

        if (Object.keys(changes).length === 0) {
          skipped.push({
            row: row.rowNumber,
            code: "SIN_CAMBIOS",
            personId: existing.id,
            message: "No hubo cambios respecto al registro existente.",
          });
          continue;
        }

        const updateData = {};
        if (changes.fullName) updateData.fullName = row.fullName;
        if (changes.category) updateData.category = row.category;
        if (changes.notes) updateData.notes = row.notes;

        pendingOps.push({
          kind: "update",
          rowNumber: row.rowNumber,
          personId: existing.id,
          reportedFullName: row.fullName ?? existing.fullName,
          changes,
          execute: (tx) => tx.person.update({ where: { id: existing.id }, data: updateData, select: { id: true } }),
        });
      } else {
        pendingOps.push({
          kind: "create",
          rowNumber: row.rowNumber,
          execute: (tx) =>
            tx.person.create({
              data: { fullName: row.fullName, documentId: row.documentId, category: row.category, notes: row.notes },
              select: { id: true, fullName: true, category: true },
            }),
        });
      }
    } else {
      const existing = existingByNameMap.get(nameKey(row.fullName));
      if (existing) {
        skipped.push({
          row: row.rowNumber,
          code: "NOMBRE_DUPLICADO_EN_BD",
          personId: existing.id,
          message: `Ya existe una persona registrada con el nombre «${row.fullName}». No se modificó.`,
        });
        continue;
      }
      pendingOps.push({
        kind: "create",
        rowNumber: row.rowNumber,
        execute: (tx) =>
          tx.person.create({
            data: { fullName: row.fullName, documentId: null, category: row.category, notes: row.notes },
            select: { id: true, fullName: true, category: true },
          }),
      });
    }
  }

  // ---- Escritura atómica (P12): una sola transacción, en chunks de 500 ----
  const created = [];
  const updated = [];

  if (pendingOps.length > 0) {
    const results = await prisma.$transaction(
      async (tx) => {
        const out = [];
        for (let i = 0; i < pendingOps.length; i += WRITE_CHUNK_SIZE) {
          const chunk = pendingOps.slice(i, i + WRITE_CHUNK_SIZE);
          // eslint-disable-next-line no-await-in-loop
          const chunkResults = await Promise.all(chunk.map((op) => op.execute(tx)));
          out.push(...chunkResults);
        }
        return out;
      },
      { timeout: TRANSACTION_TIMEOUT_MS }
    );

    results.forEach((record, idx) => {
      const op = pendingOps[idx];
      if (op.kind === "create") {
        created.push({ row: op.rowNumber, personId: record.id, fullName: record.fullName, category: record.category });
      } else {
        updated.push({ row: op.rowNumber, personId: op.personId, fullName: op.reportedFullName, changes: op.changes });
      }
    });
  }

  created.sort((a, b) => a.row - b.row);
  updated.sort((a, b) => a.row - b.row);
  skipped.sort((a, b) => a.row - b.row);
  errors.sort((a, b) => a.row - b.row);

  const totalRows = created.length + updated.length + skipped.length + errors.length;
  const truncated =
    created.length > DETAIL_LIMIT ||
    updated.length > DETAIL_LIMIT ||
    skipped.length > DETAIL_LIMIT ||
    errors.length > DETAIL_LIMIT;

  return {
    fileName: originalName,
    summary: {
      totalRows,
      created: created.length,
      updated: updated.length,
      skipped: skipped.length,
      failed: errors.length,
      blankRowsIgnored,
      ignoredColumns,
    },
    created: created.slice(0, DETAIL_LIMIT),
    updated: updated.slice(0, DETAIL_LIMIT),
    skipped: skipped.slice(0, DETAIL_LIMIT),
    errors: errors.slice(0, DETAIL_LIMIT),
    truncated,
  };
}
