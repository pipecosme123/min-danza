-- ---------------------------------------------------------------------------
-- Reporte de asistencia compartido entre equipos (Fase 9, ampliación
-- 2026-09-13): pedido del usuario -- para un turno con 2+ equipos asignados
-- (evento extraordinario, "Vigilia Unida - Comuna 21", "Ayuno Congregacional",
-- turno de Congreso), cualquiera de los líderes de esos equipos puede
-- completar UN SOLO reporte que cubre a todos los integrantes de todos los
-- equipos asignados a ese turno -- siempre que compartan la misma hora, lo
-- que ya está garantizado porque un ServiceSlot es una sola fecha+hora.
--
-- No se implementa ningún bloqueo de edición concurrente entre los líderes
-- que comparten un mismo reporte (a pedido explícito del usuario: "considera
-- más no implementa" -- dos líderes editando al mismo tiempo hoy es
-- last-write-wins, igual que ya lo era guardar dos veces seguidas). Queda
-- documentado como mejora futura, no como bug.
--
-- Escrito a mano (no generado por `prisma migrate dev`) siguiendo el mismo
-- estilo que las migraciones anteriores.
-- ---------------------------------------------------------------------------

-- 1) Si algún turno multi-equipo ya tenía más de un AttendanceReport (un
-- líder ya había creado el suyo antes de este cambio), fusionarlos en uno
-- solo antes de aplicar el nuevo índice único: se conserva el más antiguo
-- (created_at) y se re-apuntan sus entries/supports al que se conserva. No
-- hay choque de unicidad (attendance_entry.(report_id, person_id) es único)
-- porque cada equipo tiene su propio padrón, disjunto del de los demás
-- equipos del mismo turno. Nota: si el reporte descartado ya estaba
-- SUBMITTED con generalNotes propias, ese estado/nota se pierde -- caso
-- borde no encontrado en los datos reales al escribir esto (Fase 9 lleva
-- una semana en producción), documentado igual por si acaso.
DO $$
DECLARE
  dup RECORD;
  keeper_id TEXT;
BEGIN
  FOR dup IN
    SELECT service_slot_id
    FROM attendance_report
    GROUP BY service_slot_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keeper_id
    FROM attendance_report
    WHERE service_slot_id = dup.service_slot_id
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    UPDATE attendance_entry SET report_id = keeper_id
      WHERE report_id IN (
        SELECT id FROM attendance_report
        WHERE service_slot_id = dup.service_slot_id AND id <> keeper_id
      );
    UPDATE attendance_support SET report_id = keeper_id
      WHERE report_id IN (
        SELECT id FROM attendance_report
        WHERE service_slot_id = dup.service_slot_id AND id <> keeper_id
      );
    DELETE FROM attendance_report
      WHERE service_slot_id = dup.service_slot_id AND id <> keeper_id;
  END LOOP;
END $$;

-- 2) De (service_slot_id, team_id) a service_slot_id solo: a partir de ahora
-- hay, como mucho, un AttendanceReport por turno, sin importar cuántos
-- equipos tenga asignados. `team_id` se conserva en la tabla (equipo bajo el
-- que se creó, sólo representativo) pero ya no participa de la unicidad.
DROP INDEX "attendance_report_service_slot_id_team_id_key";
CREATE UNIQUE INDEX "attendance_report_service_slot_id_key" ON "attendance_report"("service_slot_id");
