import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js", "tests/**/*.test.js"],
    // Las pruebas de integración golpean una base de datos Postgres real
    // (contenedor de desarrollo `api-ejercicio-pg`), así que se corren en
    // serie para evitar que el rate limiter de login o el contador de
    // intentos se contaminen entre archivos de test que se ejecutan en
    // paralelo.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
