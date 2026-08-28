// CRUD de "versículos del mes" (VersePassage): uno o más pasajes bíblicos
// (mismo libro/capítulo, RVR1960) elegidos por el admin para mostrar en la
// página pública del mes. El texto se resuelve UNA VEZ vía
// bibleSource.service.js (scraping a BibleGateway) al agregar/editar, y se
// persiste -- la página pública nunca vuelve a llamar a la fuente externa.
// Parte 4, wise-noodling-hickey.md. El router (routes/verses.routes.js) solo
// parsea/valida/serializa; toda regla vive acá.
//
// Editable mientras el mes sea DRAFT, o FINALIZED actual/futuro (mismo
// criterio que agregar/cancelar eventos, cambiar uniforme de un turno, etc:
// assertEditableConsideringFinalization).

import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../utils/errors.js";
import { assertEditableConsideringFinalization } from "../utils/monthLifecycle.js";
import { invalidateCached } from "../lib/cache.js";
import { cacheKeyFor } from "./publicSchedule.service.js";
import { fetchVerseText } from "./bibleSource.service.js";

function invalidatePublicCache(year, month) {
  invalidateCached(cacheKeyFor(year, month));
}

const VERSE_SELECT = {
  id: true,
  book: true,
  chapter: true,
  verses: true,
  version: true,
  text: true,
  reference: true,
  createdAt: true,
};

function serializeVerse(verse) {
  return {
    id: verse.id,
    book: verse.book,
    chapter: verse.chapter,
    verses: verse.verses,
    version: verse.version,
    text: verse.text,
    reference: verse.reference,
  };
}

/** @param {string} monthCycleId */
export async function listVerses(monthCycleId) {
  const month = await prisma.monthCycle.findUnique({ where: { id: monthCycleId }, select: { id: true } });
  if (!month) throw new NotFoundError("Mes no encontrado.");

  const verses = await prisma.versePassage.findMany({
    where: { monthCycleId },
    orderBy: { createdAt: "asc" },
    select: VERSE_SELECT,
  });
  return { verses: verses.map(serializeVerse) };
}

/**
 * @param {string} monthCycleId
 * @param {{ book: string, chapter: number, verses: string }} data
 */
export async function addVerse(monthCycleId, data) {
  const month = await prisma.monthCycle.findUnique({ where: { id: monthCycleId } });
  if (!month) throw new NotFoundError("Mes no encontrado.");
  assertEditableConsideringFinalization(month);

  // fetchVerseText hace un fetch de red real -- deliberadamente FUERA de
  // cualquier transacción de Prisma (una transacción no debe esperar a una
  // fuente externa lenta/caída, eso mantendría una conexión de la base
  // ocupada sin necesidad).
  const { text, reference } = await fetchVerseText(data);

  const created = await prisma.versePassage.create({
    data: {
      monthCycleId,
      book: data.book,
      chapter: data.chapter,
      verses: data.verses,
      text,
      reference,
    },
    select: VERSE_SELECT,
  });

  invalidatePublicCache(month.year, month.month);
  return { verse: serializeVerse(created) };
}

/**
 * Si cambia la referencia (book/chapter/verses), vuelve a resolver el texto
 * con la misma llamada a bibleSource. Si el body no cambia ninguno de esos
 * tres campos, no hay necesidad de volver a scrapear.
 * @param {string} verseId
 * @param {{ book?: string, chapter?: number, verses?: string }} data
 */
export async function updateVerse(verseId, data) {
  const verse = await prisma.versePassage.findUnique({
    where: { id: verseId },
    include: { monthCycle: { select: { id: true, year: true, month: true, status: true } } },
  });
  if (!verse) throw new NotFoundError("Versículo no encontrado.", { code: "VERSICULO_NO_ENCONTRADO" });
  assertEditableConsideringFinalization(verse.monthCycle);

  const referenceChanged = data.book !== undefined || data.chapter !== undefined || data.verses !== undefined;

  const updateData = {};
  if (data.book !== undefined) updateData.book = data.book;
  if (data.chapter !== undefined) updateData.chapter = data.chapter;
  if (data.verses !== undefined) updateData.verses = data.verses;

  if (referenceChanged) {
    const merged = {
      book: data.book ?? verse.book,
      chapter: data.chapter ?? verse.chapter,
      verses: data.verses ?? verse.verses,
    };
    const { text, reference } = await fetchVerseText(merged);
    updateData.text = text;
    updateData.reference = reference;
  }

  const updated = await prisma.versePassage.update({
    where: { id: verseId },
    data: updateData,
    select: VERSE_SELECT,
  });

  invalidatePublicCache(verse.monthCycle.year, verse.monthCycle.month);
  return { verse: serializeVerse(updated) };
}

/** @param {string} verseId */
export async function deleteVerse(verseId) {
  const verse = await prisma.versePassage.findUnique({
    where: { id: verseId },
    include: { monthCycle: { select: { id: true, year: true, month: true, status: true } } },
  });
  if (!verse) throw new NotFoundError("Versículo no encontrado.", { code: "VERSICULO_NO_ENCONTRADO" });
  assertEditableConsideringFinalization(verse.monthCycle);

  await prisma.versePassage.delete({ where: { id: verseId } });

  invalidatePublicCache(verse.monthCycle.year, verse.monthCycle.month);
  return { deleted: true };
}
