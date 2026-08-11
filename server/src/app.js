// Crea la app Express (helmet, cors, json, rutas, errorHandler). Separado de
// index.js para poder testear con supertest sin abrir un puerto real.

import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import apiRouter from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  // Detrás de un proxy inverso (hosting compartido/PaaS) sin esto
  // express-rate-limit no ve la IP real del cliente y trata a todos los
  // visitantes como si vinieran de la misma IP.
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    })
  );
  app.use(express.json());

  // Health check real: confirma conexión a la base de datos, no solo que el
  // proceso Express esté vivo.
  app.get("/health", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "connected" });
    } catch {
      res.status(503).json({ status: "error", database: "disconnected" });
    }
  });

  app.use("/api", apiRouter);

  app.use((req, res) => {
    res.status(404).json({ error: { message: "Ruta no encontrada." } });
  });

  // Debe ir al final: es el único middleware con 4 argumentos (err, req, res, next).
  app.use(errorHandler);

  return app;
}
