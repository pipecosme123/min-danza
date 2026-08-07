// PATCH /api/assignments/:id (lock/unlock, cambiar equipo de una SlotAssignment).
// Lógica real: services/balance.service.js (Fase 4, todavía no existe).
// Router administrativo -> protegido con requireAuth.

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.patch("/:id", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 4: balance.service.js)." } });
});

export default router;
