// Startup file para Phusion Passenger (Node.js Selector de cPanel).
// Passenger carga este archivo con require(), pero el proyecto es ESM
// ("type": "module" en package.json) -- de ahí el import() dinámico.
// Ver docs/deployment/cpanel-deployment-plan.md §1.2/§2.
import("./src/index.js").catch((err) => {
  console.error("Fallo al arrancar la app:", err);
  process.exit(1);
});
