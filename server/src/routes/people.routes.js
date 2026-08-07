// CRUD de Person + POST /api/people/import (carga masiva CSV/Excel).
// Lógica real: services/importPeople.service.js (Fase 2, todavía no existe).
// Todo este router es administrativo -> protegido con requireAuth.

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.get("/", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 2: personas)." } });
});

router.post("/", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 2: personas)." } });
});

router.post("/import", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 2: importPeople.service.js)." } });
});

router.patch("/:id", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 2: personas)." } });
});

export default router;
