import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PublicSchedule } from "../pages/PublicSchedule.jsx";
import { ThemeProvider } from "../context/ThemeContext.jsx";

// La ruta pública ("/") no requiere sesión (no AuthProvider) pero sí depende
// de ThemeProvider porque comparte <AppHeader>/<ThemeToggle> con el resto de
// la app. `api/publicSchedule.js` se mockea completo para controlar cada
// escenario (cargando, 404 esperado, 200, error de red real) de forma
// determinista. Contrato: docs/architecture/phase5-public-page-contract.md §4.
vi.mock("../api/publicSchedule.js", () => ({
  getLatestPublicSchedule: vi.fn(),
  getPublicScheduleFor: vi.fn(),
  getScheduleHistory: vi.fn(),
}));

import { getLatestPublicSchedule, getPublicScheduleFor, getScheduleHistory } from "../api/publicSchedule.js";
import { ApiError } from "../api/client.js";

function samplePayload() {
  return {
    month: { year: 2026, month: 8, finalizedAt: "2026-08-08T20:00:00.000Z" },
    teams: [
      {
        id: "team-1",
        label: "Equipo 1",
        orderIndex: 1,
        teamType: "REGULAR",
        members: [
          { id: "tm-1", personId: "p-1", fullName: "Ana Pérez", role: "LEADER", manualOverride: false },
          { id: "tm-4", personId: "p-4", fullName: "Carla Ortiz", role: "COLLABORATOR", manualOverride: false },
        ],
      },
      {
        id: "team-2",
        label: "Equipo 2",
        orderIndex: 2,
        teamType: "REGULAR",
        members: [
          { id: "tm-2", personId: "p-2", fullName: "Luis Gómez", role: "LEADER", manualOverride: false },
          { id: "tm-5", personId: "p-5", fullName: "Diego Vega", role: "SUPPORT", manualOverride: false },
        ],
      },
      {
        id: "team-youth",
        label: "Servicio de jóvenes",
        orderIndex: 3,
        teamType: "YOUTH",
        members: [
          { id: "tm-3", personId: "p-3", fullName: "Marta Ruiz", role: "LEADER", manualOverride: false },
          // Ana Pérez también integra el equipo de jóvenes, además de su
          // equipo regular (team-1) — debe deduplicarse en el select.
          { id: "tm-6", personId: "p-1", fullName: "Ana Pérez", role: "SUPPORT", manualOverride: false },
        ],
      },
    ],
    slots: [
      {
        id: "slot-1",
        date: "2026-08-05",
        startTime: "17:00",
        slotType: "FIXED",
        title: null,
        teamsNeeded: 1,
        countsTowardBalance: true,
        uniform: { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF" },
        teams: [{ id: "team-1", label: "Equipo 1" }],
      },
      {
        id: "slot-2",
        date: "2026-08-15",
        startTime: "19:30",
        slotType: "EXTRAORDINARY",
        title: "Vigilia",
        teamsNeeded: 1,
        countsTowardBalance: true,
        uniform: null,
        teams: [{ id: "team-1", label: "Equipo 1" }],
      },
      {
        id: "slot-3",
        date: "2026-08-06",
        startTime: "17:00",
        slotType: "FIXED",
        title: null,
        teamsNeeded: 1,
        countsTowardBalance: true,
        uniform: null,
        teams: [{ id: "team-2", label: "Equipo 2" }],
      },
      {
        id: "slot-4",
        date: "2026-08-07",
        startTime: "18:00",
        slotType: "FIXED",
        title: null,
        teamsNeeded: 1,
        countsTowardBalance: true,
        uniform: null,
        teams: [{ id: "team-youth", label: "Servicio de jóvenes" }],
      },
    ],
  };
}

function renderPublicSchedule() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/"]}>
        <PublicSchedule />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("PublicSchedule (ruta pública, sin login)", () => {
  beforeEach(() => {
    getLatestPublicSchedule.mockReset();
    getPublicScheduleFor.mockReset();
    // Default sin historial: los tests que no lo ejercitan explícitamente no
    // deben ver aparecer el selector de "Ver otro mes".
    getScheduleHistory.mockReset().mockResolvedValue({ months: [] });
  });

  it("muestra un estado de carga mientras se pide el horario", async () => {
    getLatestPublicSchedule.mockReturnValue(new Promise(() => {}));
    renderPublicSchedule();

    expect(screen.getByRole("heading", { name: "Ministerio de danza" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("muestra el encabezado «Ministerio de danza» / «Lluvias de Bendiciones» y ya no el texto viejo", async () => {
    getLatestPublicSchedule.mockRejectedValueOnce(
      new ApiError("No hay ningún mes publicado para esa fecha.", {
        status: 404,
        details: { code: "MES_NO_PUBLICADO" },
      }),
    );
    renderPublicSchedule();

    expect(screen.getByRole("heading", { name: "Ministerio de danza" })).toBeInTheDocument();
    expect(screen.getByText("Lluvias de Bendiciones")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Horario del mes" })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/aquí puedes consultar los equipos, sus integrantes/i),
    ).not.toBeInTheDocument();
  });

  it("muestra el estado vacío (no un error) cuando todavía no hay ningún mes publicado", async () => {
    getLatestPublicSchedule.mockRejectedValueOnce(
      new ApiError("No hay ningún mes publicado para esa fecha.", {
        status: 404,
        details: { code: "MES_NO_PUBLICADO" },
      }),
    );
    renderPublicSchedule();

    await waitFor(() => expect(screen.getByText(/todavía no hay un mes publicado/i)).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("muestra un mensaje de error con reintentar ante un error de red real", async () => {
    getLatestPublicSchedule.mockRejectedValueOnce(new ApiError("No se pudo conectar con el servidor.", { status: 0 }));
    renderPublicSchedule();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/todavía no hay un mes publicado/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("muestra los equipos y el horario del mes publicado", async () => {
    getLatestPublicSchedule.mockResolvedValueOnce(samplePayload());
    renderPublicSchedule();

    await waitFor(() => expect(screen.getByText("Agosto 2026")).toBeInTheDocument());

    // Equipos, incluido el equipo de jóvenes.
    expect(screen.getByRole("heading", { name: "Equipo 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Equipo 2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Servicio de jóvenes" })).toBeInTheDocument();
    // Ana Pérez integra dos equipos (regular y jóvenes): aparece en ambas tarjetas.
    expect(screen.getAllByText("Ana Pérez", { selector: ".member-list__name" })).toHaveLength(2);
    expect(screen.getByText("Marta Ruiz", { selector: ".member-list__name" })).toBeInTheDocument();

    // Horario, agrupado por fecha.
    expect(screen.getByText("Vigilia")).toBeInTheDocument();
    expect(screen.getByText("Uniforme A")).toBeInTheDocument();
  });

  it("muestra un evento extraordinario cancelado con la etiqueta «Cancelado» y sin equipos (Fase 4c)", async () => {
    const payload = samplePayload();
    payload.slots.push({
      id: "slot-5",
      date: "2026-08-22",
      startTime: "19:00",
      slotType: "EXTRAORDINARY",
      title: "Retiro de danza",
      teamsNeeded: 1,
      countsTowardBalance: false,
      uniform: null,
      teams: [],
      cancelledAt: "2026-08-10T00:00:00.000Z",
    });
    getLatestPublicSchedule.mockResolvedValueOnce(payload);
    renderPublicSchedule();

    await waitFor(() => expect(screen.getByText("Retiro de danza")).toBeInTheDocument());
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
    expect(screen.getByText("Este evento fue cancelado.")).toBeInTheDocument();
  });

  it("no muestra las etiquetas de rol Apoyo/Ministro, solo Líder cuando corresponde", async () => {
    getLatestPublicSchedule.mockResolvedValueOnce(samplePayload());
    renderPublicSchedule();

    await waitFor(() => expect(screen.getByText("Agosto 2026")).toBeInTheDocument());

    // Ana Pérez es líder de Equipo 1: su badge "Líder" sí debe verse.
    expect(screen.getAllByText("Líder").length).toBeGreaterThan(0);
    // Ningún badge de "Apoyo" o "Ministro" debe estar presente en la página pública,
    // aunque haya integrantes con esos roles (Diego Vega=SUPPORT, Carla Ortiz=COLLABORATOR).
    expect(screen.queryByText("Apoyo")).not.toBeInTheDocument();
    expect(screen.queryByText("Ministro")).not.toBeInTheDocument();
    // Los nombres siguen visibles, solo sin la etiqueta de rol (se busca dentro de la
    // lista de integrantes, no del select, que también lista estos nombres como opciones).
    expect(screen.getByText("Diego Vega", { selector: ".member-list__name" })).toBeInTheDocument();
    expect(screen.getByText("Carla Ortiz", { selector: ".member-list__name" })).toBeInTheDocument();
  });

  it("el filtro por persona reduce equipos y horario a los suyos, y se puede limpiar", async () => {
    getLatestPublicSchedule.mockResolvedValueOnce(samplePayload());
    renderPublicSchedule();

    await waitFor(() => expect(screen.getByText("Agosto 2026")).toBeInTheDocument());

    const combobox = screen.getByLabelText("Buscar mi equipo");
    await userEvent.click(combobox);

    // Opciones deduplicadas y ordenadas alfabéticamente (Ana Pérez una sola vez).
    const listbox = screen.getByRole("listbox");
    const optionNames = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(optionNames).toEqual(["Todas las personas", "Ana Pérez", "Carla Ortiz", "Diego Vega", "Luis Gómez", "Marta Ruiz"]);

    await userEvent.click(within(listbox).getByRole("option", { name: "Ana Pérez" }));

    // Equipos: solo el regular de Ana (Equipo 1) y el de jóvenes, donde también aparece. Equipo 2 desaparece.
    expect(screen.getByRole("heading", { name: "Equipo 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Servicio de jóvenes" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Equipo 2" })).not.toBeInTheDocument();
    // El select sigue listando a todas las personas (no se filtra a sí mismo), pero la
    // lista de integrantes de los equipos mostrados ya no incluye a Luis ni a Diego.
    expect(screen.queryByText("Luis Gómez", { selector: ".member-list__name" })).not.toBeInTheDocument();
    expect(screen.queryByText("Diego Vega", { selector: ".member-list__name" })).not.toBeInTheDocument();

    // Horario (vista de lista): solo turnos de Equipo 1 y del equipo de jóvenes.
    expect(screen.getByText("Vigilia")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Jueves 6 de agosto/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Viernes 7 de agosto/i })).toBeInTheDocument();

    // Restaurar el filtro con "Todas las personas".
    await userEvent.click(combobox);
    await userEvent.click(screen.getByRole("option", { name: "Todas las personas" }));
    expect(screen.getByRole("heading", { name: "Equipo 2" })).toBeInTheDocument();
    expect(screen.getByText("Luis Gómez", { selector: ".member-list__name" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Jueves 6 de agosto/i })).toBeInTheDocument();
  });

  it("el selector de historial permite ver un mes anterior (hasta 1 año) y resetea el filtro de persona activo", async () => {
    getLatestPublicSchedule.mockResolvedValueOnce(samplePayload());
    getScheduleHistory.mockResolvedValueOnce({
      months: [
        { year: 2026, month: 8 }, // el mismo que "Más reciente" -- no debe listarse dos veces.
        { year: 2025, month: 8 },
      ],
    });
    const olderPayload = {
      ...samplePayload(),
      month: { year: 2025, month: 8, finalizedAt: "2025-08-08T20:00:00.000Z" },
    };
    getPublicScheduleFor.mockResolvedValueOnce(olderPayload);

    renderPublicSchedule();
    await waitFor(() => expect(screen.getByText("Agosto 2026")).toBeInTheDocument());

    // Activar un filtro de persona antes de cambiar de mes.
    const combobox = screen.getByLabelText("Buscar mi equipo");
    await userEvent.click(combobox);
    await userEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Ana Pérez" }));
    expect(screen.queryByRole("heading", { name: "Equipo 2" })).not.toBeInTheDocument();

    // El selector de historial solo lista "Agosto 2025" (2026 ya es "Más reciente").
    const monthSelect = screen.getByLabelText("Ver otro mes");
    expect(within(monthSelect).getAllByRole("option").map((o) => o.textContent)).toEqual(["Más reciente", "Agosto 2025"]);

    await userEvent.selectOptions(monthSelect, "2025-8");

    expect(getPublicScheduleFor).toHaveBeenCalledWith(2025, 8);
    await waitFor(() => expect(screen.getByText("Agosto 2025")).toBeInTheDocument());
    // El filtro de persona se resetea al cambiar de mes.
    expect(screen.getByRole("heading", { name: "Equipo 2" })).toBeInTheDocument();
  });

  it("no muestra el selector de historial cuando no hay ningún mes anterior disponible", async () => {
    getLatestPublicSchedule.mockResolvedValueOnce(samplePayload());
    getScheduleHistory.mockResolvedValueOnce({ months: [{ year: 2026, month: 8 }] });
    renderPublicSchedule();

    await waitFor(() => expect(screen.getByText("Agosto 2026")).toBeInTheDocument());
    expect(screen.queryByLabelText("Ver otro mes")).not.toBeInTheDocument();
  });

  it("la vista de calendario mensual siempre muestra todos los turnos, incluso con un filtro de persona activo", async () => {
    getLatestPublicSchedule.mockResolvedValueOnce(samplePayload());
    renderPublicSchedule();

    await waitFor(() => expect(screen.getByText("Agosto 2026")).toBeInTheDocument());

    const combobox = screen.getByLabelText("Buscar mi equipo");
    await userEvent.click(combobox);
    await userEvent.click(screen.getByRole("option", { name: "Ana Pérez" }));

    // En la vista de lista, el turno de Equipo 2 (Luis Gómez) no aparece.
    expect(screen.queryByRole("heading", { name: /Jueves 6 de agosto/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Vista de calendario" }));

    // La grilla mensual (tabla con encabezados de día de semana) muestra TODO el mes,
    // sin filtrar: el día 6 (turno de Equipo 2) sigue presente en la grilla.
    expect(screen.getByRole("columnheader", { name: "Lunes" })).toBeInTheDocument();
    expect(screen.getByText("Equipo 2")).toBeInTheDocument();
  });

  it("incluye un enlace de acceso administrador, pero ningún control de login en la vista pública", async () => {
    getLatestPublicSchedule.mockRejectedValueOnce(
      new ApiError("No hay ningún mes publicado para esa fecha.", {
        status: 404,
        details: { code: "MES_NO_PUBLICADO" },
      }),
    );
    renderPublicSchedule();

    await waitFor(() => expect(screen.getByText(/todavía no hay un mes publicado/i)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /acceso administrador/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
  });
});
