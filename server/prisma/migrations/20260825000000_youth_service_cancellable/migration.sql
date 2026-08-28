-- ---------------------------------------------------------------------------
-- Cancelar/eliminar el Servicio de jóvenes sin re-sortear todo el mes.
-- Ver plan wise-noodling-hickey.md, Parte 1.
-- ---------------------------------------------------------------------------

-- Escrito a mano (no generado por `prisma migrate dev`: el entorno de esta
-- sesión es no interactivo) siguiendo el mismo estilo que las migraciones
-- previas.

-- La migración 20260808170000 restringió `cancelled_at` a slots EXTRAORDINARY
-- porque en ese momento el Servicio de jóvenes no se podía cancelar (solo se
-- quitaba re-sorteando TODO el mes). Ahora youthTeam.service.js#cancelYouthService
-- reusa el mismo mecanismo cancelledAt/countsTowardBalance que cancelEvent
-- para el turno YOUTH_SERVICE -- FIXED sigue sin tener ese concepto (los
-- turnos fijos no se cancelan individualmente, solo se re-sortea el mes).
ALTER TABLE "service_slot" DROP CONSTRAINT "service_slot_cancelled_only_extraordinary";

ALTER TABLE "service_slot"
  ADD CONSTRAINT "service_slot_cancelled_only_cancellable_types"
      CHECK ("cancelled_at" IS NULL OR "slot_type" IN ('EXTRAORDINARY', 'YOUTH_SERVICE'));
