// Bootstrap: carga env (falla rápido si falta algo), monta la app, escucha.

import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`API escuchando en http://localhost:${env.PORT} (NODE_ENV=${env.NODE_ENV})`);
});

async function shutdown(signal) {
  console.log(`Recibido ${signal}, cerrando servidor...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
