// Roster manual del evento del último sábado (SpecialSaturdayMember).
// Lógica real: Fase 4. Router administrativo -> protegido con requireAuth.
//
// IMPORTANTE: este router se monta en "/", así que requireAuth se aplica
// POR RUTA, no con `router.use(requireAuth)` a nivel de router (ver
// teams.routes.js para el detalle de por qué eso filtraría hacia endpoints
// públicos como /schedule).

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/months/:id/special-saturday", requireAuth, (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 4: evento especial del último sábado)." } });
});

router.put("/months/:id/special-saturday/members", requireAuth, (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 4: evento especial del último sábado)." } });
});

export default router;
