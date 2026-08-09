// Limitadores de tasa por IP. `loginLimiter` frena fuerza bruta sobre
// POST /api/auth/login; `publicLimiter` evita abuso/scraping agresivo del
// endpoint público de horario; `adminLimiter` es el freno genérico para
// TODAS las rutas administrativas autenticadas (personas, meses, equipos,
// eventos, asignaciones, slots, uniformes) — hallazgo de auditoría QA
// Fase 7: si un JWT se filtra, hoy no había ningún límite que frenara el
// abuso. Generoso a propósito (un único admin real legítimo no debería
// acercarse ni de lejos al umbral en el uso normal de la app, incluida la
// vista de calendario que dispara varios GET seguidos), pero real: sigue
// siendo un freno efectivo contra un script con un token robado.

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

export const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 300, // 300 requests por IP por minuto (5/seg sostenido) en rutas administrativas
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Demasiadas solicitudes administrativas. Intenta de nuevo en un momento." } },
});
