// Barajado genérico de arrays. Usado por teamGeneration.service.js (Fase 3)
// para el sorteo de líder/apoyo/colaborador y por balance.service.js para el
// desempate aleatorio al elegir equipos con igual conteo.
//
// Soporta una semilla opcional (PRNG determinista) para que los tests puedan
// reproducir un sorteo exacto sin mockear Math.random.

/** Mulberry32: PRNG simple y rápido, suficiente para desempates de sorteo (no criptográfico). */
function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle. No muta el array de entrada.
 * @template T
 * @param {T[]} items
 * @param {number} [seed] si se omite, usa Math.random (no reproducible).
 * @returns {T[]}
 */
export function shuffle(items, seed) {
  const result = [...items];
  const random = typeof seed === "number" ? mulberry32(seed) : Math.random;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Elige un elemento al azar del array.
 * @template T
 * @param {T[]} items
 * @param {number} [seed]
 * @returns {T | undefined}
 */
export function pickRandom(items, seed) {
  if (items.length === 0) return undefined;
  const random = typeof seed === "number" ? mulberry32(seed) : Math.random;
  return items[Math.floor(random() * items.length)];
}
