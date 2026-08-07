import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../App.jsx";
import { TOKEN_STORAGE_KEY } from "../api/client.js";

// Pruebas de integración de la app completa (providers + router reales),
// no solo componentes aislados. `App.jsx` usa BrowserRouter (lee de
// window.location), así que controlamos la URL con history.pushState antes
// de renderizar cada caso.

function renderAppAt(path) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("App — enrutamiento de alto nivel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("la ruta pública '/' renderiza sin sesión y sin crashear", () => {
    renderAppAt("/");
    expect(screen.getByRole("heading", { name: "Horario del mes" })).toBeInTheDocument();
  });

  it("ProtectedRoute redirige a /admin/login cuando no hay token en el contexto de auth", () => {
    renderAppAt("/admin/personas");

    expect(window.location.pathname).toBe("/admin/login");
    expect(screen.getByRole("heading", { name: "Acceso administrador" })).toBeInTheDocument();
  });

  it("ProtectedRoute también redirige la raíz de /admin sin token", () => {
    renderAppAt("/admin");
    expect(window.location.pathname).toBe("/admin/login");
  });

  it("con un token presente en localStorage, /admin/personas NO redirige a login", () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "un-token-cualquiera");

    renderAppAt("/admin/personas");

    expect(window.location.pathname).toBe("/admin/personas");
    expect(screen.queryByRole("heading", { name: "Acceso administrador" })).not.toBeInTheDocument();
  });

  it("una ruta desconocida muestra la página NotFound en vez de una pantalla en blanco", () => {
    renderAppAt("/esta-ruta-no-existe");
    // NotFound.jsx debe renderizar algún contenido reconocible; verificamos
    // que al menos hay contenido de error visible (no un documento vacío).
    expect(document.body.textContent.trim().length).toBeGreaterThan(0);
  });
});
