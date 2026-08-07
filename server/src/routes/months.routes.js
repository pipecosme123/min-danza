// POST /api/months, GET /api/months, GET /api/months/:id — ciclo mensual.
// Lógica real: services de ciclo mensual (Fase 3, todavía no existen).
// Router administrativo -> protegido con requireAuth.

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.get("/", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 3: ciclo mensual)." } });
});

router.post("/", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 3: ciclo mensual)." } });
});

router.get("/:id", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 3: ciclo mensual)." } });
});

export default router;
