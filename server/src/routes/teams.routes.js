// POST /api/months/:id/generate-teams, GET/PATCH equipos.
// Lógica real: services/teamGeneration.service.js (Fase 3, todavía no existe).
// Router administrativo -> protegido con requireAuth.
//
// IMPORTANTE: este router se monta en "/" (mezcla rutas bajo /months/:id/...
// y /teams/:id), así que requireAuth se aplica POR RUTA (no con
// `router.use(requireAuth)` a nivel de router) — un `router.use` sin filtro
// de path en un router montado en "/" correría como middleware global para
// CUALQUIER request de la app, incluidos los endpoints públicos.

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/months/:id/generate-teams", requireAuth, (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 3: teamGeneration.service.js)." } });
});

router.get("/months/:id/teams", requireAuth, (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 3: equipos)." } });
});

router.patch("/teams/:teamId", requireAuth, (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 3: edición manual de equipos)." } });
});

export default router;
