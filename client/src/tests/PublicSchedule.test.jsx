import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PublicSchedule } from "../pages/PublicSchedule.jsx";
import { ThemeProvider } from "../context/ThemeContext.jsx";

// La ruta pública ("/") no requiere sesión (no AuthProvider) pero sí depende
// de ThemeProvider porque comparte <AppHeader>/<ThemeToggle> con el resto de
// la app. Verifica que renderiza sin crashear y sin exigir autenticación, y
// que el estado "aún no hay mes publicado" (esperado en esta fase) queda
// visible y entendible para un usuario no técnico.
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
  it("renderiza sin crashear y muestra el título de la página", () => {
    renderPublicSchedule();
    expect(screen.getByRole("heading", { name: "Horario del mes" })).toBeInTheDocument();
  });

  it("muestra un mensaje entendible cuando todavía no hay mes publicado (no una pantalla en blanco)", () => {
    renderPublicSchedule();
    expect(screen.getByText(/todavía no hay un mes publicado/i)).toBeInTheDocument();
  });

  it("incluye un enlace de acceso administrador, pero ningún control de login en la vista pública", () => {
    renderPublicSchedule();
    expect(screen.getByRole("link", { name: /acceso administrador/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
  });
});
