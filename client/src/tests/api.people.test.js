// Regresión: PeopleManager.test.jsx mockea todo el módulo `api/people.js`,
// así que nunca ejercita la construcción real del query string -- un bug real
// (getPeople no reenviaba `isAdultoMayor` al backend, el filtro quedaba
// silenciosamente ignorado) pasó inadvertido hasta probar la app real.
// Este archivo golpea la implementación REAL de getPeople, mockeando solo
// `fetch` (el límite de transporte), para que este tipo de bug no se repita.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPeople } from "../api/people.js";

function mockFetchOnce(body = { data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => body,
  });
}

describe("api/people.js getPeople", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reenvía isAdultoMayor=true al backend", async () => {
    mockFetchOnce();
    await getPeople({ isAdultoMayor: true });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("isAdultoMayor=true");
  });

  it("reenvía isAdultoMayor=false al backend", async () => {
    mockFetchOnce();
    await getPeople({ isAdultoMayor: false });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("isAdultoMayor=false");
  });

  it("no agrega isAdultoMayor a la URL cuando no se pide filtrar por él", async () => {
    mockFetchOnce();
    await getPeople({ isJoven: true });
    const [url] = global.fetch.mock.calls[0];
    expect(url).not.toContain("isAdultoMayor");
  });

  it("sigue reenviando isJoven correctamente (no regresión)", async () => {
    mockFetchOnce();
    await getPeople({ isJoven: true });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("isJoven=true");
  });
});
