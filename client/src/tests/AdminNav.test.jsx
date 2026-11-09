import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "../context/ThemeContext.jsx";
import { AdminNav } from "../components/Layout/AdminNav.jsx";

// Fase 10, etapa 3: la navegación del admin es un único <nav> (barra inferior
// en el teléfono, menú lateral en escritorio, solo por CSS) más la hoja «Más»
// con las secciones secundarias, el tema y cerrar sesión.

function renderNav({ path = "/admin/personas", onLogout = vi.fn() } = {}) {
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/*" element={<AdminNav onLogout={onLogout} />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
  return { onLogout };
}

describe("AdminNav", () => {
  it("lista las 6 secciones una sola vez y marca la activa", () => {
    renderNav({ path: "/admin/eventos" });
    const nav = screen.getByRole("navigation", { name: "Secciones del panel de administración" });

    for (const label of ["Personas", "Equipos", "Eventos", "Uniformes", "Asistencia", "Accesos"]) {
      expect(within(nav).getAllByRole("link", { name: label })).toHaveLength(1);
    }
    expect(within(nav).getByRole("link", { name: "Eventos" })).toHaveAttribute("aria-current", "page");
  });

  it("«Más» abre una hoja con Asistencia, Accesos, tema y cerrar sesión", async () => {
    const user = userEvent.setup();
    const { onLogout } = renderNav();

    await user.click(screen.getByRole("button", { name: "Más" }));
    const sheet = screen.getByRole("dialog", { name: "Más opciones" });

    expect(within(sheet).getByRole("link", { name: "Asistencia" })).toHaveAttribute("href", "/admin/asistencia");
    expect(within(sheet).getByRole("link", { name: "Accesos" })).toHaveAttribute("href", "/admin/accesos");
    expect(within(sheet).getByRole("button", { name: /Tema (claro|oscuro)/ })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Cerrar sesión" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Más opciones" })).not.toBeInTheDocument();
  });

  it("elegir una sección desde «Más» cierra la hoja", async () => {
    const user = userEvent.setup();
    renderNav();

    await user.click(screen.getByRole("button", { name: "Más" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Accesos" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
