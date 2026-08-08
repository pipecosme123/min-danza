import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeopleManager } from "../pages/PeopleManager.jsx";

// `PeopleManager` no usa hooks de react-router (no Link/useNavigate), así
// que se puede renderizar de forma aislada. Se mockea `api/people.js`
// completo para no depender de un servidor real (el backend se construye en
// paralelo, ver docs/architecture/phase2-people-contract.md) y para poder
// controlar cada escenario (listado, vacío, error) de forma determinista.
vi.mock("../api/people.js", () => ({
  getPeople: vi.fn(),
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
  deactivatePerson: vi.fn(),
  importPeople: vi.fn(),
}));

import { getPeople } from "../api/people.js";

function samplePage(overrides = {}) {
  return {
    data: [
      {
        id: "1",
        fullName: "Ana Gómez",
        documentId: "1234567",
        category: "ELEGIBLE_LIDER",
        active: true,
        notes: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    ...overrides,
  };
}

describe("PeopleManager", () => {
  beforeEach(() => {
    getPeople.mockReset();
  });

  it("carga y muestra el listado de personas al montar, pidiendo solo activas por defecto", async () => {
    getPeople.mockResolvedValueOnce(samplePage());
    render(<PeopleManager />);

    expect(screen.getByRole("heading", { name: "Personas" })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    expect(getPeople).toHaveBeenCalledWith(expect.objectContaining({ active: true, page: 1 }));
  });

  it("muestra un estado vacío entendible cuando no hay personas registradas", async () => {
    getPeople.mockResolvedValueOnce(
      samplePage({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
    );
    render(<PeopleManager />);

    await waitFor(() =>
      expect(screen.getByText("Todavía no hay personas registradas")).toBeInTheDocument(),
    );
  });

  it("muestra un error entendible con opción de reintentar si la carga falla", async () => {
    getPeople.mockRejectedValueOnce(new Error("No se pudo conectar con el servidor."));
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("abre el formulario de alta al pulsar «Nueva persona»", async () => {
    getPeople.mockResolvedValue(samplePage());
    const user = userEvent.setup();
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Nueva persona" }));

    expect(screen.getByRole("heading", { name: "Nueva persona" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre completo/)).toBeInTheDocument();
  });
});
