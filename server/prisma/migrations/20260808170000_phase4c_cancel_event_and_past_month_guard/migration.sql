-- ---------------------------------------------------------------------------
-- Fase 4c: edición limitada de eventos extraordinarios tras publicar el mes.
-- Ver docs/architecture/phase4c-post-publish-edits-contract.md §1.
-- ---------------------------------------------------------------------------

-- Escrito a mano (no generado por `prisma migrate dev`: el entorno de esta
-- sesión es no interactivo y esa CLI exige confirmar cambios de forma
-- interactiva) siguiendo el mismo estilo que las migraciones previas.

ALTER TABLE "service_slot" ADD COLUMN "cancelled_at" TIMESTAMP(3);

-- Solo un evento EXTRAORDINARY puede cancelarse: los turnos FIXED/YOUTH_SERVICE
-- no tienen ese concepto.
ALTER TABLE "service_slot"
  ADD CONSTRAINT "service_slot_cancelled_only_extraordinary"
      CHECK ("cancelled_at" IS NULL OR "slot_type" = 'EXTRAORDINARY');
