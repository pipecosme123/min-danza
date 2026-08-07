// POST/DELETE /api/months/:id/events (eventos extraordinarios).
// Lógica real: services/scheduleGeneration.service.js + balance.service.js
// (Fase 4, todavía no existen). Router administrativo -> protegido con requireAuth.
//
// IMPORTANTE: este router se monta en "/" (mezcla rutas bajo /months/:id/...
// y /events/:id), así que requireAuth se aplica POR RUTA, no con
// `router.use(requireAuth)` a nivel de router (ver teams.routes.js para el
// detalle de por qué eso filtraría hacia endpoints públicos como /schedule).

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/months/:id/events", requireAuth, (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 4: eventos extraordinarios)." } });
});

router.delete("/events/:eventId", requireAuth, (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 4: eventos extraordinarios)." } });
});

export default router;
