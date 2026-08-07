// GET /api/schedule/:year/:month — único endpoint de lectura PÚBLICO (sin
// auth). Solo debe devolver meses MonthCycle.status === 'FINALIZED' cuando
// se implemente (Fase 5) — un mes DRAFT nunca se expone públicamente.
// Candidato a caché en memoria (lib/cache.js) una vez implementado.

import { Router } from "express";
import { publicLimiter } from "../middleware/rateLimit.js";

const router = Router();

router.use(publicLimiter);

router.get("/:year/:month", (req, res) => {
  res.status(501).json({ error: { message: "No implementado todavía (Fase 5: página pública)." } });
});

export default router;
