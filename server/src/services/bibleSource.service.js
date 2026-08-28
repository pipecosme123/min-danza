// Adaptador aislado a BibleGateway (scraping): resuelve el texto de un
// pasaje bíblico en Reina Valera 1960. Parte 4, wise-noodling-hickey.md.
//
// AVISO (documentado en el plan, no bloqueante): hacer scraping de
// BibleGateway es inherentemente frágil -- depende de que su HTML no
// cambie -- y es dudoso que su ToS permita acceso automatizado. Se procede a
// pedido explícito del usuario (las APIs gratuitas sin key solo ofrecen
// Reina Valera 1909, no la 1960). Por eso este adaptador vive AISLADO en su
// propio archivo: si BibleGateway deja de funcionar, solo hay que reescribir
// este módulo (misma firma fetchVerseText), sin tocar verses.service.js ni
// el resto del sistema.
//
// Selectores verificados a mano (2026-08-25) haciendo fetch real a
// biblegateway.com/passage/?search=<referencia>&version=RVR1960 e
// inspeccionando el HTML devuelto (Juan 3:16-18, Génesis 1:1-5, 1 Juan 5:7-8,
// Marcos 16:9-20, una referencia inválida y una lista de versículos sueltos
// separados por coma):
//   - Cada verso/rango pedido con "," (ej. "16,18,20") viene en un bloque
//     ".passage-text" SEPARADO (uno por cada número/rango), no todos en el
//     mismo bloque -- hay que recorrer TODOS los ".passage-text" de la
//     página, no solo el primero, y concatenar su texto.
//   - Dentro de cada ".passage-text", el contenedor real del texto es
//     ".passage-content .text-html" (la clase completa incluye
//     "version-RVR1960 result-text-style-normal text-html", pero "text-html"
//     es la parte estable/genérica).
//   - El número de versículo viene como <sup class="versenum"> (o, para el
//     primer versículo de un capítulo, <span class="chapternum">) -- hay que
//     quitarlos antes de leer el texto.
//   - Las referencias cruzadas inline vienen como
//     <sup class="crossreference">(A)</sup> -- se quitan igual.
//   - Los títulos de sección (ej. "De tal manera amó Dios al mundo") vienen
//     como <h3>/<h4> ANTES del texto del versículo -- se excluyen del texto
//     final (son un agregado editorial de BibleGateway, no parte del pasaje).
//   - El bloque de notas al pie/referencias cruzadas completo (cuando
//     existe) vive en un <div class="crossrefs">, y el link final
//     "Read full chapter" en <a class="full-chap-link"> -- ambos se excluyen.
//   - Una referencia INVÁLIDA (ej. "Juan 99:99", capítulo/versículo
//     inexistente) responde 200 OK pero SIN ningún ".passage-text" en el
//     HTML (BibleGateway ni siquiera intenta renderizar el pasaje) -- por
//     eso "200 OK pero cero bloques encontrados" se interpreta como
//     VERSICULO_NO_ENCONTRADO, no como un fallo de la fuente.

import * as cheerio from "cheerio";
import { AppError, ValidationError } from "../utils/errors.js";

const BASE_URL = "https://www.biblegateway.com/passage/";
const VERSION = "RVR1960";

// User-Agent explícito: BibleGateway devuelve contenido distinto (o vacío)
// a clientes sin cabecera de navegador reconocible.
const USER_AGENT = "Mozilla/5.0 (compatible; OrganizacionEquiposServiceBot/1.0)";

function buildUrl({ book, chapter, verses }) {
  const search = `${book} ${chapter}:${verses}`;
  return `${BASE_URL}?search=${encodeURIComponent(search)}&version=${VERSION}`;
}

// Selectores/elementos a excluir del texto final -- ver nota de cabecera.
const ELEMENTS_TO_STRIP =
  "h3, h4, sup.versenum, sup.crossreference, span.chapternum, .footnotes, .footnote, .crossrefs, a.full-chap-link";

/**
 * Extrae el texto plano del pasaje del HTML crudo devuelto por BibleGateway.
 * Devuelve "" (string vacío) si la página no tiene ningún bloque de pasaje --
 * el caller decide qué error tirar según ese resultado.
 *
 * Hallazgo de QA (2026-08-27): en pasajes de poesía (ej. Salmos), cada verso/
 * línea viene envuelto en su propio `<p class="verse line">`, y entre esos
 * `<p>` consecutivos el HTML fuente A VECES no trae ningún espacio en blanco
 * (`</p><p class="verse line">`, sin espacio), a diferencia de los pasajes en
 * prosa donde siempre hay un espacio entre `</p>` y el siguiente `<p>`. Llamar
 * `.text()` sobre todo el bloque de una sola vez concatena esos casos sin
 * espacio ("descansar;Junto"). Por eso se junta el texto de cada `<p>` por
 * separado con un espacio explícito entre ellos, en vez de leer el bloque
 * completo de un tirón.
 * @param {string} html
 */
function extractPassageText(html) {
  const $ = cheerio.load(html);
  const blocks = $(".passage-text .text-html");
  if (blocks.length === 0) return "";

  const parts = [];
  blocks.each((_, el) => {
    const block = $(el).clone();
    block.find(ELEMENTS_TO_STRIP).remove();
    const lines = block.find("p");
    const rawText = lines.length > 0 ? lines.map((__, p) => $(p).text()).get().join(" ") : block.text();
    const chunk = rawText.replace(/\s+/g, " ").trim();
    if (chunk) parts.push(chunk);
  });

  return parts.join(" ").trim();
}

/**
 * Resuelve el texto de un pasaje bíblico en RVR1960 vía BibleGateway. Se
 * llama UNA VEZ (al agregar/editar un VersePassage) -- el resultado se
 * persiste, la página pública nunca vuelve a llamar esto.
 * @param {{ book: string, chapter: number, verses: string }} ref
 * @returns {Promise<{ text: string, reference: string }>}
 */
export async function fetchVerseText({ book, chapter, verses }) {
  const url = buildUrl({ book, chapter, verses });

  let html;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      throw new Error(`BibleGateway respondió ${res.status}`);
    }
    html = await res.text();
  } catch {
    // Fallo de red o status no-ok: la fuente externa no está disponible
    // ahora mismo -- distinto de "la referencia no existe".
    throw new AppError("No se pudo consultar la fuente bíblica en este momento. Intentá de nuevo más tarde.", 503, {
      code: "FUENTE_BIBLICA_NO_DISPONIBLE",
    });
  }

  let text;
  try {
    text = extractPassageText(html);
  } catch {
    // El HTML no tiene la estructura esperada (BibleGateway cambió su
    // markup) -- también es "fuente no disponible", no "referencia inválida".
    throw new AppError("No se pudo interpretar la respuesta de la fuente bíblica.", 503, {
      code: "FUENTE_BIBLICA_NO_DISPONIBLE",
    });
  }

  if (!text) {
    throw new ValidationError("No se encontró ese pasaje bíblico. Revisá el libro, el capítulo y los versículos.", {
      code: "VERSICULO_NO_ENCONTRADO",
    });
  }

  return { text, reference: `${book} ${chapter}:${verses} (${VERSION})` };
}
