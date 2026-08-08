import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UniformsManager } from "../pages/UniformsManager.jsx";
import { ToastViewport } from "../components/ui/Toast.jsx";

// Se mockea `api/uniforms.js` completo para controlar cada escenario (alta,
// edición, configuración por día de semana, configuración del Servicio de
// jóvenes, duplicado) sin depender de un servidor real. Contrato cerrado:
// docs/architecture/phase4-schedule-contract.md §7.
vi.mock("../api/uniforms.js", () => ({
  getUniforms: vi.fn(),
  createUniform: vi.fn(),
  updateUniform: vi.fn(),
  getWeekdayUniforms: vi.fn(),
  updateWeekdayUniform: vi.fn(),
  getYouthServiceUniform: vi.fn(),
  updateYouthServiceUniform: vi.fn(),
}));

import {
  getUniforms,
  createUniform,
  updateUniform,
  getWeekdayUniforms,
  updateWeekdayUniform,
  getYouthServiceUniform,
  updateYouthServiceUniform,
} from "../api/uniforms.js";
import { ApiError } from "../api/client.js";

function sampleUniforms() {
  return [
    { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF", description: "Camisa azul", active: true },
    { id: "u-2", name: "Uniforme B", colorHex: "#15803D", description: null, active: false },
  ];
}

function renderPage() {
  return render(
    <>
      <UniformsManager />
      <ToastViewport />
    </>,
  );
}

describe("UniformsManager", () => {
  beforeEach(() => {
    getUniforms.mockReset();
    createUniform.mockReset();
    updateUniform.mockReset();
    getWeekdayUniforms.mockReset();
    updateWeekdayUniform.mockReset();
    getYouthServiceUniform.mockReset();
    updateYouthServiceUniform.mockReset();

    getUniforms.mockResolvedValue(sampleUniforms());
    getWeekdayUniforms.mockResolvedValue([{ weekday: "WEDNESDAY", uniformId: "u-1" }]);
    getYouthServiceUniform.mockResolvedValue({ uniformId: null });
  });

  it("lista los uniformes existentes, activos e inactivos", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());
    expect(screen.getAllByText("Uniforme A").length).toBeGreaterThan(0);
    expect(screen.getByText("Uniforme B")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
  });

  it("permite crear un uniforme nuevo", async () => {
    createUniform.mockResolvedValueOnce({
      id: "u-3",
      name: "Uniforme C",
      colorHex: "#1d4ed8",
      description: "",
      active: true,
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Nuevo uniforme" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Nombre/), { target: { value: "Uniforme C" } });
    await user.click(within(dialog).getByRole("button", { name: "Crear uniforme" }));

    await waitFor(() =>
      expect(createUniform).toHaveBeenCalledWith(expect.objectContaining({ name: "Uniforme C" })),
    );
    await waitFor(() => expect(screen.getByText("Se creó el uniforme.")).toBeInTheDocument());
  });

  it("permite editar un uniforme existente, incluida su bandera de activo", async () => {
    updateUniform.mockResolvedValueOnce({
      id: "u-1",
      name: "Uniforme A",
      colorHex: "#1E40AF",
      description: "Camisa azul",
      active: false,
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());

    const row = screen.getByText("Camisa azul").closest("tr");
    await user.click(within(row).getByRole("button", { name: "Editar" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Nombre/)).toHaveValue("Uniforme A");
    await user.click(within(dialog).getByRole("checkbox", { name: "Uniforme activo" }));
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(updateUniform).toHaveBeenCalledWith("u-1", expect.objectContaining({ active: false })),
    );
  });

  it("muestra UNIFORME_DUPLICADO de forma clara al crear un uniforme repetido", async () => {
    createUniform.mockRejectedValueOnce(
      new ApiError("Ya existe.", { status: 409, details: { code: "UNIFORME_DUPLICADO" } }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Nuevo uniforme" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Nombre/), { target: { value: "Uniforme A" } });
    await user.click(within(dialog).getByRole("button", { name: "Crear uniforme" }));

    await waitFor(() =>
      expect(screen.getByText("Ya existe un uniforme con ese nombre.")).toBeInTheDocument(),
    );
  });

  it("permite configurar el uniforme de miércoles y domingo", async () => {
    // Los selects de configuración solo ofrecen uniformes activos: se agrega
    // un tercero activo para reasignar el domingo (Uniforme B está inactivo
    // en `sampleUniforms` y no debe aparecer como opción).
    getUniforms.mockResolvedValue([
      ...sampleUniforms(),
      { id: "u-3", name: "Uniforme C", colorHex: "#000000", description: null, active: true },
    ]);
    updateWeekdayUniform.mockResolvedValueOnce({ weekday: "SUNDAY", uniformId: "u-3" });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Domingo")).toBeInTheDocument());
    expect(within(screen.getByLabelText("Domingo")).queryByRole("option", { name: "Uniforme B" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Domingo"), "u-3");

    await waitFor(() => expect(updateWeekdayUniform).toHaveBeenCalledWith("SUNDAY", "u-3"));
    await waitFor(() => expect(screen.getByText("Se actualizó el uniforme de domingo.")).toBeInTheDocument());
  });

  it("permite configurar el uniforme del Servicio de jóvenes", async () => {
    updateYouthServiceUniform.mockResolvedValueOnce({ uniformId: "u-1" });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Servicio de jóvenes")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Servicio de jóvenes"), "u-1");

    await waitFor(() => expect(updateYouthServiceUniform).toHaveBeenCalledWith("u-1"));
    await waitFor(() =>
      expect(screen.getByText("Se actualizó el uniforme del Servicio de jóvenes.")).toBeInTheDocument(),
    );
  });
});
