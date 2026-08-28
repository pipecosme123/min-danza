// Monta todos los routers bajo /api. El único prefijo sin auth es
// /api/auth/login (público por naturaleza) y /api/schedule (lectura pública
// de la organización del mes ya finalizada).
//
// `adminLimiter` (hallazgo de auditoría QA Fase 7, ver rateLimit.js) se monta
// aquí, por router, sobre TODAS las rutas administrativas — peopleRoutes/
// monthsRoutes/assignmentsRoutes/slotsRoutes/uniformsRoutes tienen prefijo
// propio así que un `adminLimiter` puesto en su mount point de acá solo
// aplica a ellas. teamsRoutes/eventsRoutes/eventGroupsRoutes/versesRoutes son
// la excepción: están montadas en "/" (mezclan rutas /months/:id/... y
// /teams|/events|/event-groups|/verses/:id, ver el comentario en esos
// archivos sobre por qué requireAuth se aplica POR RUTA ahí) — por la misma
// razón, adminLimiter se aplica por ruta DENTRO de esos archivos, no acá,
// para no correr como middleware global sobre /api/schedule (que ya tiene su
// propio publicLimiter).

import { Router } from "express";
import authRoutes from "./auth.routes.js";
import peopleRoutes from "./people.routes.js";
import monthsRoutes from "./months.routes.js";
import teamsRoutes from "./teams.routes.js";
import eventsRoutes from "./events.routes.js";
import eventGroupsRoutes from "./eventGroups.routes.js";
import versesRoutes from "./verses.routes.js";
import assignmentsRoutes from "./assignments.routes.js";
import slotsRoutes from "./slots.routes.js";
import uniformsRoutes from "./uniforms.routes.js";
import scheduleRoutes from "./schedule.routes.js";
import { adminLimiter } from "../middleware/rateLimit.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/people", adminLimiter, peopleRoutes);
router.use("/months", adminLimiter, monthsRoutes);
router.use("/", teamsRoutes); // expone /months/:id/generate-teams y /teams/:teamId (adminLimiter por ruta, ver teams.routes.js)
router.use("/", eventsRoutes); // expone /months/:id/events y /events/:eventId (adminLimiter por ruta, ver events.routes.js)
router.use("/", eventGroupsRoutes); // expone /months/:id/event-groups y /event-groups/:id (adminLimiter por ruta, ver eventGroups.routes.js)
router.use("/", versesRoutes); // expone /months/:id/verses y /verses/:id (adminLimiter por ruta, ver verses.routes.js)
router.use("/assignments", adminLimiter, assignmentsRoutes);
router.use("/slots", adminLimiter, slotsRoutes);
router.use("/uniforms", adminLimiter, uniformsRoutes);
router.use("/schedule", scheduleRoutes);

export default router;
