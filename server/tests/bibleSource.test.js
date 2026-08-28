// fetchVerseText (bibleSource.service.js) -- adaptador de scraping a
// BibleGateway. Parte 4, wise-noodling-hickey.md. Sin dependencia de red: se
// mockea `fetch` global directamente (no hay un patrón previo de mocks de
// llamadas externas en este suite) con fragmentos de HTML real, capturados a
// mano el 2026-08-25 haciendo un fetch real a biblegateway.com/passage/ (ver
// el comentario de cabecera de bibleSource.service.js para el detalle
// completo de los selectores).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchVerseText } from "../src/services/bibleSource.service.js";

// Fragmento real de Juan 3:16-18 (RVR1960): un solo bloque ".passage-text",
// con encabezado de sección (<h3>, debe excluirse), números de versículo
// (<sup class="versenum">, deben excluirse) y el link final "Read full
// chapter" (debe excluirse).
const JUAN_3_16_18_HTML = `<!DOCTYPE html><html><body>
<div class="passage-text">
<div class='passage-content passage-class-0'><div class="version-RVR1960 result-text-style-normal text-html">
 <h3><span id="es-RVR1960-26138" class="text John-3-16">De tal manera amó Dios al mundo</span></h3><p><span class="text John-3-16"><sup class="versenum">16 </sup>Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna.</span> <span id="es-RVR1960-26139" class="text John-3-17"><sup class="versenum">17 </sup>Porque no envió Dios a su Hijo al mundo para condenar al mundo, sino para que el mundo sea salvo por él.</span> <span id="es-RVR1960-26140" class="text John-3-18"><sup class="versenum">18 </sup>El que en él cree, no es condenado; pero el que no cree, ya ha sido condenado, porque no ha creído en el nombre del unigénito Hijo de Dios.</span> </p><a class="full-chap-link" href="/passage/?search=Juan%203&version=RVR1960" title="View Full Chapter">Read full chapter</a>
</div>
</div>
</div>
</body></html>`;

// Fragmento real de Génesis 1:1-5 (RVR1960): incluye <span class="chapternum">
// (versículo 1, primero del capítulo, distinto de <sup class="versenum">) y
// una referencia cruzada inline (<sup class="crossreference">), más el bloque
// completo de "Cross references" al final -- ambos deben excluirse del texto.
const GENESIS_1_1_5_HTML = `<!DOCTYPE html><html><body>
<div class="passage-text">
<div class='passage-content passage-class-0'><div class="version-RVR1960 result-text-style-normal text-html">
 <h3><span id="es-RVR1960-1" class="text Gen-1-1">La creación</span></h3><p class="chapter-1"><span class="text Gen-1-1"><span class="chapternum">1 </span>En el principio creó Dios los cielos y la tierra.</span> <span id="es-RVR1960-2" class="text Gen-1-2"><sup class="versenum">2 </sup>Y la tierra estaba desordenada y vacía, y las tinieblas estaban sobre la faz del abismo, y el Espíritu de Dios se movía sobre la faz de las aguas.</span></p> <p><span id="es-RVR1960-3" class="text Gen-1-3"><sup class="versenum">3 </sup>Y dijo Dios: Sea la luz;<sup class='crossreference' data-cr='#ces-RVR1960-3A'>(<a href="#ces-RVR1960-3A" title="See cross-reference A">A</a>)</sup> y fue la luz.</span> <span id="es-RVR1960-4" class="text Gen-1-4"><sup class="versenum">4 </sup>Y vio Dios que la luz era buena; y separó Dios la luz de las tinieblas.</span> <span id="es-RVR1960-5" class="text Gen-1-5"><sup class="versenum">5 </sup>Y llamó Dios a la luz Día, y a las tinieblas llamó Noche. Y fue la tarde y la mañana un día.</span></p> <a class="full-chap-link" href="/passage/?search=G%C3%A9nesis%201&version=RVR1960" title="View Full Chapter">Read full chapter</a>
<div class="crossrefs hidden">
<h4>Cross references</h4><ol><li id="ces-RVR1960-3A"><a href="#es-RVR1960-3" title="Go to Génesis 1:3">Génesis 1:3</a> : <a class="crossref-link" href="/passage/?search=2%20Corintios%204%3A6&version=RVR1960">2 Co. 4.6.</a></li></ol></div>
</div>
</div>
</div>
</body></html>`;

// Fragmento real de una lista de versículos separados por coma
// ("Juan 3:16,18,20"): BibleGateway renderiza UN bloque ".passage-text"
// separado por cada versículo/rango pedido, no todos juntos -- hay que
// recorrerlos todos y concatenar.
const JUAN_3_COMMA_LIST_HTML = `<!DOCTYPE html><html><body>
<div class="passage-text">
<div class='passage-content passage-class-0'><div class="version-RVR1960 result-text-style-normal text-html">
 <h3><span class="text John-3-16">De tal manera amó Dios al mundo</span></h3><p><span class="text John-3-16"><sup class="versenum">16 </sup>Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna.</span> </p><a class="full-chap-link" href="/passage/?search=Juan%203&version=RVR1960" title="View Full Chapter">Read full chapter</a>
</div>
</div>
</div>
<div class="passage-text">
<div class='passage-content passage-class-0'><div class="version-RVR1960 result-text-style-normal text-html">
<p> <span class="text John-3-18"><sup class="versenum">18 </sup>El que en él cree, no es condenado; pero el que no cree, ya ha sido condenado, porque no ha creído en el nombre del unigénito Hijo de Dios.</span> </p><a class="full-chap-link" href="/passage/?search=Juan%203&version=RVR1960" title="View Full Chapter">Read full chapter</a>
</div>
</div>
</div>
<div class="passage-text">
<div class='passage-content passage-class-0'><div class="version-RVR1960 result-text-style-normal text-html">
<p> <span class="text John-3-20"><sup class="versenum">20 </sup>Porque todo aquel que hace lo malo, aborrece la luz y no viene a la luz, para que sus obras no sean reprendidas.</span> </p><a class="full-chap-link" href="/passage/?search=Juan%203&version=RVR1960" title="View Full Chapter">Read full chapter</a>
</div>
</div>
</div>
</body></html>`;

// Fragmento real de Salmos 23:1-3 (RVR1960): pasaje de POESÍA, donde cada
// verso/línea viene envuelto en su propio <p class="verse line">. Hallazgo de
// QA (2026-08-27, verificado con un fetch real): entre algunos <p>
// consecutivos el HTML fuente NO trae ningún espacio en blanco
// ("</p><p class=\"verse line\">"), a diferencia de los pasajes en prosa --
// concatenar el texto del bloque de un tirón pegaba palabras
// ("descansar;Junto"). Regresión de ese bug.
const SALMOS_23_1_3_HTML = `<!DOCTYPE html><html><body>
<div class="passage-text">
<div class='passage-content passage-class-0'><div class="version-RVR1960 result-text-style-normal text-html">
 <h3><span id="es-RVR1960-14237" class="text Ps-23-1">Jehová es mi pastor</span></h3><h4 class="psalm-title"><span class="text Ps-23-1">Salmo de David.</span></h4><div class="poetry"><p class="verse line"><span class="text Ps-23-1"><span class="chapternum">23 </span>Jehová es mi pastor; nada me faltará.</span></p> <p class="verse line"><span id="es-RVR1960-14238" class="text Ps-23-2"><sup class="versenum">2 </sup>En lugares de delicados pastos me hará descansar;</span></p><p class="verse line"><span class="text Ps-23-2">Junto a aguas de reposo me pastoreará.<sup class='crossreference' data-cr='#ces-RVR1960-14238A'>(<a href="#ces-RVR1960-14238A" title="See cross-reference A">A</a>)</sup></span></p> <p class="verse line"><span id="es-RVR1960-14239" class="text Ps-23-3"><sup class="versenum">3 </sup>Confortará mi alma;</span></p><p class="verse line"><span class="text Ps-23-3">Me guiará por sendas de justicia por amor de su nombre.</span></p></div>  <a class="full-chap-link" href="/passage/?search=Salmos%2023&version=RVR1960" title="View Full Chapter">Read full chapter</a>
<div class="crossrefs hidden">
<h4>Cross references</h4><ol><li id="ces-RVR1960-14238A"><a href="#es-RVR1960-14238" title="Go to Salmos 23:2">Salmos 23:2</a> : <a class="crossref-link" href="/passage/?search=Apocalipsis%207%3A17&version=RVR1960">Ap. 7.17.</a></li></ol></div>
</div>
</div>
</div>
</body></html>`;

// Referencia inválida (ej. "Juan 99:99"): BibleGateway responde 200 OK pero
// sin ningún bloque ".passage-text" -- confirmado con un fetch real.
const INVALID_REFERENCE_HTML = `<!DOCTYPE html><html><head><title>Juan 99:99 RVR1960 -  - Bible Gateway</title></head><body>
<div class="some-other-content">No hay pasaje para mostrar.</div>
</body></html>`;

function mockFetchOnce({ ok = true, status = 200, text }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, text: async () => text });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchVerseText", () => {
  it("extrae el texto de un rango de versículos sin números ni encabezado de sección", async () => {
    const fetchMock = mockFetchOnce({ text: JUAN_3_16_18_HTML });

    const result = await fetchVerseText({ book: "Juan", chapter: 3, verses: "16-18" });

    expect(result.text).toBe(
      "Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna. Porque no envió Dios a su Hijo al mundo para condenar al mundo, sino para que el mundo sea salvo por él. El que en él cree, no es condenado; pero el que no cree, ya ha sido condenado, porque no ha creído en el nombre del unigénito Hijo de Dios."
    );
    expect(result.reference).toBe("Juan 3:16-18 (RVR1960)");

    // La URL pedida tiene la referencia URL-encoded y version=RVR1960.
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain("biblegateway.com/passage/");
    expect(calledUrl).toContain("version=RVR1960");
    expect(calledUrl).toContain(encodeURIComponent("Juan 3:16-18"));
  });

  it("excluye el número del primer versículo del capítulo (chapternum) y las referencias cruzadas inline", async () => {
    mockFetchOnce({ text: GENESIS_1_1_5_HTML });

    const result = await fetchVerseText({ book: "Génesis", chapter: 1, verses: "1-5" });

    expect(result.text).not.toMatch(/\d/); // sin ningún dígito de versículo/nota
    expect(result.text).not.toContain("Cross references");
    expect(result.text).not.toContain("(A)");
    expect(result.text.startsWith("En el principio creó Dios los cielos y la tierra.")).toBe(true);
    expect(result.text).toContain("Y llamó Dios a la luz Día");
  });

  it("concatena TODOS los bloques .passage-text de una lista de versículos separados por coma", async () => {
    mockFetchOnce({ text: JUAN_3_COMMA_LIST_HTML });

    const result = await fetchVerseText({ book: "Juan", chapter: 3, verses: "16,18,20" });

    expect(result.text).toContain("Porque de tal manera amó Dios al mundo");
    expect(result.text).toContain("El que en él cree, no es condenado");
    expect(result.text).toContain("Porque todo aquel que hace lo malo");
    expect(result.reference).toBe("Juan 3:16,18,20 (RVR1960)");
  });

  it("inserta un espacio entre versos de poesía aunque el HTML fuente no traiga espacio entre <p> consecutivos (Salmos)", async () => {
    mockFetchOnce({ text: SALMOS_23_1_3_HTML });

    const result = await fetchVerseText({ book: "Salmos", chapter: 23, verses: "1-3" });

    expect(result.text).toBe(
      "Jehová es mi pastor; nada me faltará. En lugares de delicados pastos me hará descansar; Junto a aguas de reposo me pastoreará. Confortará mi alma; Me guiará por sendas de justicia por amor de su nombre."
    );
    // Regresión explícita del bug encontrado: nunca dos palabras pegadas sin
    // espacio en un punto donde el HTML separaba versos con <p>.
    expect(result.text).not.toContain("descansar;Junto");
    expect(result.text).not.toContain("alma;Me");
  });

  it("VERSICULO_NO_ENCONTRADO cuando la página no tiene ningún bloque de pasaje (referencia inválida)", async () => {
    mockFetchOnce({ text: INVALID_REFERENCE_HTML });

    await expect(fetchVerseText({ book: "Juan", chapter: 99, verses: "99" })).rejects.toMatchObject({
      statusCode: 400,
      details: { code: "VERSICULO_NO_ENCONTRADO" },
    });
  });

  it("FUENTE_BIBLICA_NO_DISPONIBLE si la respuesta HTTP no es ok", async () => {
    mockFetchOnce({ ok: false, status: 503, text: "" });

    await expect(fetchVerseText({ book: "Juan", chapter: 3, verses: "16" })).rejects.toMatchObject({
      statusCode: 503,
      details: { code: "FUENTE_BIBLICA_NO_DISPONIBLE" },
    });
  });

  it("FUENTE_BIBLICA_NO_DISPONIBLE si fetch rechaza (fallo de red)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    await expect(fetchVerseText({ book: "Juan", chapter: 3, verses: "16" })).rejects.toMatchObject({
      statusCode: 503,
      details: { code: "FUENTE_BIBLICA_NO_DISPONIBLE" },
    });
  });
});
