// Limitadores de tasa por IP. `loginLimiter` frena fuerza bruta sobre
// POST /api/auth/login; `publicLimiter` evita abuso/scraping agresivo del
// endpoint público de horario.

import rateLimit from "express-rate-limit";

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // 10 intentos por IP cada 15 minutos
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde." } },
});

export const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 60, // 60 requests por IP por minuto
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Demasiadas solicitudes. Intenta de nuevo en un momento." } },
});
