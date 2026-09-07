// Fase 9 · Gestión administrativa de cuentas de líder. Montado en
// /api/leader-accounts (prefijo propio -> requireAuth con router.use, mismo
// patrón que people.routes.js / months.routes.js).
//
// El router sólo parsea/valida/serializa; la lógica vive en
// leaderAccounts.service.js. Contrato:
// docs/architecture/phase9-attendance-reports-contract.md §5.3.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createLeaderAccount,
  listLeaderAccounts,
  updateLeaderAccount,
  resetLeaderPassword,
} from "../services/leaderAccounts.service.js";

const router = Router();

router.use(requireAuth);

const idParamSchema = z.object({ id: z.string().min(1).max(40) });
const createSchema = z.object({ personId: z.string().min(1).max(40) });
const patchSchema = z
  .object({
    username: z.string().trim().min(3).max(40).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => d.username !== undefined || d.active !== undefined, {
    message: "Nada para actualizar: enviá username o active.",
  });

router.get("/", async (req, res, next) => {
  try {
    res.json(await listLeaderAccounts());
  } catch (err) {
    next(err);
  }
});

router.post("/", validate({ body: createSchema }), async (req, res, next) => {
  try {
    res.status(201).json(await createLeaderAccount(req.body.personId));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", validate({ params: idParamSchema, body: patchSchema }), async (req, res, next) => {
  try {
    res.json(await updateLeaderAccount(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reset-password", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    res.json(await resetLeaderPassword(req.params.id));
  } catch (err) {
    next(err);
  }
});

export default router;
