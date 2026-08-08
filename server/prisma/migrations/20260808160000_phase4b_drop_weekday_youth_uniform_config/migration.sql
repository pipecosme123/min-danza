-- ---------------------------------------------------------------------------
-- Fase 4b: los defaults automáticos de uniforme por día de semana / Servicio
-- de jóvenes se eliminan por completo (no quedan ni como sugerencia interna).
-- Ver docs/architecture/phase4b-schedule-refinements-contract.md §1.1.
-- Cada turno nace sin uniforme; se asigna a mano por fecha (ServiceSlot.uniformId
-- sigue siendo la única fuente de verdad, ya estaba diseñado para esto desde
-- Fase 1).
-- ---------------------------------------------------------------------------

-- Escrito a mano (no generado por `prisma migrate dev`: el entorno de esta
-- sesión es no interactivo y esa CLI exige confirmar la pérdida de datos de
-- forma interactiva) siguiendo el mismo estilo que las migraciones previas.

ALTER TABLE "weekday_uniform" DROP CONSTRAINT "weekday_uniform_uniform_id_fkey";
DROP TABLE "weekday_uniform";

ALTER TABLE "youth_service_uniform" DROP CONSTRAINT "youth_service_uniform_uniform_id_fkey";
DROP TABLE "youth_service_uniform";
