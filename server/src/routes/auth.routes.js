import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { loginLimiter } from "../middleware/rateLimit.js";
import { login } from "../services/auth.service.js";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, "username es obligatorio"),
  password: z.string().min(1, "password es obligatorio"),
});

router.post("/login", loginLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const result = await login(username, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
