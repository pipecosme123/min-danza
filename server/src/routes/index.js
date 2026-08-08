// Monta todos los routers bajo /api. El único prefijo sin auth es
// /api/auth/login (público por naturaleza) y /api/schedule (lectura pública
// de la organización del mes ya finalizada).

import { Router } from "express";
import authRoutes from "./auth.routes.js";
import peopleRoutes from "./people.routes.js";
import monthsRoutes from "./months.routes.js";
import teamsRoutes from "./teams.routes.js";
import eventsRoutes from "./events.routes.js";
import assignmentsRoutes from "./assignments.routes.js";
import slotsRoutes from "./slots.routes.js";
import uniformsRoutes from "./uniforms.routes.js";
import scheduleRoutes from "./schedule.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/people", peopleRoutes);
router.use("/months", monthsRoutes);
router.use("/", teamsRoutes); // expone /months/:id/generate-teams y /teams/:teamId
router.use("/", eventsRoutes); // expone /months/:id/events y /events/:eventId
router.use("/assignments", assignmentsRoutes);
router.use("/slots", slotsRoutes);
router.use("/uniforms", uniformsRoutes);
router.use("/schedule", scheduleRoutes);

export default router;
