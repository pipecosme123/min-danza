import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PublicSchedule } from "../pages/PublicSchedule.jsx";
import { ThemeProvider } from "../context/ThemeContext.jsx";
import { REMEMBERED_PERSON_KEY } from "../hooks/useRememberedPerson.js";

// Fase 10, etapa 4: vistas por pestaña (?vista=) y «Tu próximo servicio» con
// la persona recordada en el navegador (decisiones 2026-11-09).

vi.mock("../api/publicSchedule.js", () => ({
  getLatestPublicSchedule: vi.fn(),
  getPublicScheduleFor: vi.fn(),
  getScheduleHistory: vi.fn(),
}));

import { getLatestPublicSchedule, getScheduleHistory } from "../api/publicSchedule.js";

function payload() {
  return {
    month: { year: 2026, month: 11, finalizedAt: "2026-11-01T20:00:00.000Z" },
    teams: [
      {
        id: "team-1",
        label: "Equipo 1",
        orderIndex: 1,
        teamType: "REGULAR",
        members: [
          { id: "m1", personId: "p-1", fullName: "Ana Pérez", role: "LEADER" },
          { id: "m2", personId: "p-2", fullName: "Carla Ortiz", role: "COLLABORATOR" },
        ],
      },
      {
        id: "team-2",
        label: "Equipo 2",
        orderIndex: 2,
        teamType: "REGULAR",
        members: [{ id: "m3", personId: "p-3", fullName: "Luis Gómez", role: "LEADER" }],
      },
    ],
    slots: [
      {
        id: "s1",
        date: "2026-11-04",
        startTime: "17:00",
        slotType: "FIXED",
        title: null,
        uniform: null,
        teams: [{ id: "team-2", label: "Equipo 2" }],
      },
      {
        id: "s2",
        date: "2026-11-06",
        startTime: "19:00",
        slotType: "FIXED",
        title: "Vigilia Unida - Comuna 21",
        uniform: { id: "u1", name: "Camiseta Amarilla", colorHex: "#eeff00" },
        teams: [
          { id: "team-1", label: "Equipo 1" },
          { id: "team-2", label: "Equipo 2" },
        ],
      },
      {
        id: "s3",
        date: "2026-11-29",
        startTime: "08:00",
        slotType: "FIXED",
        title: null,
        uniform: null,
        teams: [{ id: "team-1", label: "Equipo 1" }],
      },
    ],
  };
}

function renderAt(path = "/") {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <PublicSchedule />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("PublicSchedule — Tu próximo servicio y vistas (Fase 10)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T10:00:00"));
    getLatestPublicSchedule.mockReset().mockResolvedValue(payload());
    getScheduleHistory.mockReset().mockResolvedValue({ months: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sin persona recordada invita a elegir el nombre", async () => {
    renderAt();
    const card = await screen.findByRole("region", { name: "Tu próximo servicio" });
    expect(within(card).getByRole("button", { name: "Elegir mi nombre" })).toBeInTheDocument();
  });

  it("con persona recordada muestra su próximo servicio, uniforme y la marca «Tu equipo»", async () => {
    localStorage.setItem(REMEMBERED_PERSON_KEY, "p-1");
    renderAt();

    const card = await screen.findByRole("region", { name: /Hola, Ana · tu próximo servicio/ });
    expect(within(card).getByText("En 3 días")).toBeInTheDocument();
    expect(within(card).getByText("Viernes 6 de noviembre")).toBeInTheDocument();
    expect(within(card).getByText(/Vigilia Unida - Comuna 21/)).toBeInTheDocument();
    expect(within(card).getByText("Equipo 1 + Equipo 2")).toBeInTheDocument();
    expect(within(card).getByText("Camiseta Amarilla")).toBeInTheDocument();

    const teamsSection = screen.getByRole("region", { name: "Equipos" });
    expect(within(teamsSection).getByText("Tu equipo")).toBeInTheDocument();
  });

  it("«No soy Ana» olvida la persona recordada", async () => {
    localStorage.setItem(REMEMBERED_PERSON_KEY, "p-1");
    renderAt();

    const card = await screen.findByRole("region", { name: /Hola, Ana/ });
    await userEvent.click(within(card).getByRole("button", { name: "No soy Ana" }));

    expect(localStorage.getItem(REMEMBERED_PERSON_KEY)).toBeNull();
    expect(screen.getByRole("region", { name: "Tu próximo servicio" })).toBeInTheDocument();
  });

  it("elegir una persona en «Buscar mi equipo» la recuerda en el navegador", async () => {
    renderAt("/?vista=horario");
    await waitFor(() => expect(screen.getByLabelText("Buscar mi equipo")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Buscar mi equipo"), "Luis");
    await userEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Luis Gómez" }));

    expect(localStorage.getItem(REMEMBERED_PERSON_KEY)).toBe("p-3");
  });

  it("«Esta semana» lista los turnos de los próximos 7 días y marca los propios", async () => {
    localStorage.setItem(REMEMBERED_PERSON_KEY, "p-3");
    renderAt();

    const week = await screen.findByRole("region", { name: "Esta semana" });
    const items = within(week).getAllByRole("listitem");
    expect(items).toHaveLength(2); // s1 y s2; s3 (29 nov) queda fuera de los 7 días
    expect(within(items[0]).getByText("Tú")).toBeInTheDocument();
  });

  it("la vista pedida por ?vista= queda en el <main> y en la barra de pestañas", async () => {
    renderAt("/?vista=equipos");
    await screen.findByRole("region", { name: "Equipos" });

    expect(document.getElementById("main-content")).toHaveAttribute("data-vista", "equipos");
    const tabs = screen.getByRole("navigation", { name: "Secciones" });
    expect(within(tabs).getByRole("link", { name: "Equipos" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Líder" })).toHaveAttribute("href", "/lider");
  });

  it("una vista desconocida cae en Inicio", async () => {
    renderAt("/?vista=cualquiera");
    await screen.findByRole("region", { name: "Tu próximo servicio" });
    expect(document.getElementById("main-content")).toHaveAttribute("data-vista", "inicio");
  });
});
