import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom no implementa window.matchMedia. ThemeContext lo usa para detectar
// prefers-color-scheme, así que lo mockeamos para que cualquier prueba que
// renderice <App/> (envuelto en ThemeProvider) no explote por esto.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
