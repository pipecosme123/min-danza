-- ---------------------------------------------------------------------------
-- Parte 1, 2 y 4 del plan wise-noodling-hickey.md:
--   1) teamsNeeded de un evento extraordinario deja de estar fijo a {1,2} --
--      admite 1..cantidad de equipos REGULAR del mes (el tope real se valida
--      en events.service.js, acá solo se relaja el CHECK de la base).
--   2) EventGroup ("Congreso", nombre genérico): 2+ fechas, cada fecha con
--      1+ turnos con equipos elegidos a mano. Cada turno es un ServiceSlot
--      EXTRAORDINARY normal con event_group_id -- SlotAssignment.slot_index
--      ya no puede estar limitado a {0,1} (un turno de Congreso puede llevar
--      más de 2 equipos elegidos a mano).
--   3) VersePassage: versículo(s) del mes (RVR1960, resuelto por scraping a
--      BibleGateway y persistido una sola vez).
--
-- Escrito a mano (no generado por `prisma migrate dev`: el entorno de esta
-- sesión es no interactivo) siguiendo el mismo estilo que las migraciones
-- previas.
-- ---------------------------------------------------------------------------

-- 1) Relajar el CHECK de teams_needed: la migración init lo fijó a
-- BETWEEN 1 AND 2 (cuando el único caso de 2 equipos era el último domingo /
-- eventos sueltos). Ahora un evento extraordinario -- y cada turno de un
-- EventGroup -- puede pedir hasta la cantidad total de equipos REGULAR del
-- mes, que es dinámica. El tope real (regularTeamCount) se valida en
-- events.service.js/eventGroups.service.js, no acá; a nivel de base solo se
-- exige que sea positivo.
ALTER TABLE "service_slot" DROP CONSTRAINT "service_slot_teams_needed_range";
ALTER TABLE "service_slot" ADD CONSTRAINT "service_slot_teams_needed_positive" CHECK ("teams_needed" >= 1);

-- 2) Relajar el CHECK de slot_index (I7 original: "tope duro de 2 equipos
-- por slot"). ESE tope ya no aplica a los turnos de un EventGroup, donde el
-- admin puede elegir a mano más de 2 equipos para un mismo turno -- el tope
-- real (que slot_index no repita para el mismo service_slot_id) lo sigue
-- garantizando el @@unique([serviceSlotId, slotIndex]) de abajo, que no se
-- toca.
ALTER TABLE "slot_assignment" DROP CONSTRAINT "slot_assignment_slot_index_range";
ALTER TABLE "slot_assignment" ADD CONSTRAINT "slot_assignment_slot_index_positive" CHECK ("slot_index" >= 0);

-- 3) EventGroup ("Congreso").
CREATE TABLE "event_group" (
    "id" TEXT NOT NULL,
    "month_cycle_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_group_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_group_month_cycle_id_idx" ON "event_group"("month_cycle_id");

ALTER TABLE "event_group" ADD CONSTRAINT "event_group_month_cycle_id_fkey"
    FOREIGN KEY ("month_cycle_id") REFERENCES "month_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- service_slot.event_group_id: liga un turno de Congreso a su grupo. Nullable
-- -- la inmensa mayoría de los ServiceSlot (FIXED, YOUTH_SERVICE, eventos
-- sueltos) no pertenecen a ningún grupo.
ALTER TABLE "service_slot" ADD COLUMN "event_group_id" TEXT;

CREATE INDEX "service_slot_event_group_id_idx" ON "service_slot"("event_group_id");

ALTER TABLE "service_slot" ADD CONSTRAINT "service_slot_event_group_id_fkey"
    FOREIGN KEY ("event_group_id") REFERENCES "event_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) VersePassage ("versículo del mes").
CREATE TABLE "verse_passage" (
    "id" TEXT NOT NULL,
    "month_cycle_id" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verses" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'RVR1960',
    "text" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verse_passage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verse_passage_month_cycle_id_idx" ON "verse_passage"("month_cycle_id");

ALTER TABLE "verse_passage" ADD CONSTRAINT "verse_passage_month_cycle_id_fkey"
    FOREIGN KEY ("month_cycle_id") REFERENCES "month_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
