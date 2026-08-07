// Instancia única de PrismaClient (singleton). Solo services/ y
// prisma/seed.js deben importar este módulo — routes/ y middleware/ nunca
// tocan Prisma directamente.

import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
