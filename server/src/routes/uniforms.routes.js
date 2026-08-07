// CRUD de Uniform + configuración de WeekdayUniform.
// Lógica real: Fase 3-4. Router administrativo -> protegido con requireAuth.

import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.get("/", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (uniformes)." } });
});

router.post("/", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (uniformes)." } });
});

router.get("/weekday-config", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (config de uniforme por día de semana)." } });
});

router.put("/weekday-config", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (config de uniforme por día de semana)." } });
});

export default router;
