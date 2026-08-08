-- ---------------------------------------------------------------------------
-- Fase 4: horario, balance, eventos extraordinarios y uniformes.
-- Ver docs/architecture/phase4-schedule-contract.md §0-1.
-- ---------------------------------------------------------------------------

-- Rename enum value SlotType.SPECIAL -> YOUTH_SERVICE. Prisma no genera esta
-- sintaxis solo (por eso este archivo se escribió a mano en vez de con
-- `prisma migrate dev`): la alternativa que SÍ generaría automáticamente
-- (crear un tipo nuevo, migrar la columna, soltar el viejo) es más invasiva
-- y no hace falta porque, a esta altura del proyecto, ningún ServiceSlot usa
-- todavía el valor 'SPECIAL' (el sábado especial nunca se generó en Fase 1-3).
ALTER TYPE "slot_type" RENAME VALUE 'SPECIAL' TO 'YOUTH_SERVICE';

-- El roster manual del sábado especial ya no existe como concepto (ver
-- CLAUDE.md, "Servicio de jóvenes"): el equipo de ese slot es directamente
-- el Team teamType YOUTH del mes, sorteado/armado en generate-teams.
ALTER TABLE "special_saturday_member" DROP CONSTRAINT "special_saturday_member_person_id_fkey";
ALTER TABLE "special_saturday_member" DROP CONSTRAINT "special_saturday_member_service_slot_id_fkey";
DROP TABLE "special_saturday_member";

-- I5 ya no aplica: YOUTH_SERVICE SÍ cuenta al balance (a diferencia del
-- viejo SPECIAL). No hay ningún CHECK reemplazante porque, en esta fase,
-- todo slot generado nace con counts_toward_balance = true sin excepción.
ALTER TABLE "service_slot" DROP CONSTRAINT "service_slot_special_never_counts";

-- Config del uniforme del Servicio de jóvenes (singleton, ver
-- YouthServiceUniform en schema.prisma).
CREATE TABLE "youth_service_uniform" (
    "id" TEXT NOT NULL,
    "uniform_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youth_service_uniform_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "youth_service_uniform" ADD CONSTRAINT "youth_service_uniform_uniform_id_fkey" FOREIGN KEY ("uniform_id") REFERENCES "uniform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
