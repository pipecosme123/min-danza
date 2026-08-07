// Lee y VALIDA process.env con zod. Falla al arrancar (throw) si falta algo
// o si un valor tiene un formato inválido — nunca arrancamos "a medias" con
// un secreto vacío o un puerto no numérico.

import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET debe tener al menos 16 caracteres"),
  ADMIN_USERNAME: z.string().min(1, "ADMIN_USERNAME es obligatoria"),
  ADMIN_PASSWORD: z.string().min(1, "ADMIN_PASSWORD es obligatoria"),
  PORT: z
    .string()
    .default("4000")
    .transform((val) => Number.parseInt(val, 10))
    .pipe(z.number().int().positive()),
  CLIENT_ORIGIN: z.string().min(1, "CLIENT_ORIGIN es obligatoria"),
  APP_TIMEZONE: z.string().min(1).default("America/Bogota"),
  NODE_ENV: z.string().default("development"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    // Falla rápido y ruidoso: nunca arrancar el servidor con configuración
    // inválida o incompleta.
    throw new Error(`Configuración de entorno inválida:\n${details}`);
  }
  return parsed.data;
}

export const env = loadEnv();
