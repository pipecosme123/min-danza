-- CreateEnum
CREATE TYPE "team_type" AS ENUM ('REGULAR', 'YOUTH');

-- DropIndex
-- Reemplazado más abajo por el índice único PARCIAL
-- team_member_one_regular_team_per_person (WHERE team_type = 'REGULAR'):
-- "una persona, un solo equipo REGULAR por mes" ya NO aplica al equipo
-- YOUTH (una persona puede estar en su equipo regular y en el de jóvenes el
-- mismo mes). Ver docs/architecture/phase3-teams-contract.md y CLAUDE.md.
DROP INDEX "team_member_month_cycle_id_person_id_key";

-- AlterTable
ALTER TABLE "month_cycle" ADD COLUMN     "youth_team_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "youth_team_size" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "person" ADD COLUMN     "is_joven" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "team" ADD COLUMN     "team_type" "team_type" NOT NULL DEFAULT 'REGULAR';

-- AlterTable
-- team_type no tiene default a nivel de schema.prisma a propósito (el
-- código siempre debe rellenarlo explícitamente, igual que month_cycle_id).
-- Para las filas YA existentes (previas a que YOUTH existiera como concepto)
-- se backfillea a 'REGULAR' porque son, por definición, equipos regulares.
ALTER TABLE "team_member" ADD COLUMN     "team_type" "team_type";
UPDATE "team_member" SET "team_type" = 'REGULAR' WHERE "team_type" IS NULL;
ALTER TABLE "team_member" ALTER COLUMN "team_type" SET NOT NULL;

-- CreateIndex
CREATE INDEX "person_active_is_joven_idx" ON "person"("active", "is_joven");

-- ---------------------------------------------------------------------------
-- SQL crudo manual (no expresable en schema.prisma): índice único parcial.
-- Mismo patrón que team_member_one_leader_per_team (init migration) — un
-- @@unique de Prisma no soporta condiciones WHERE.
-- ---------------------------------------------------------------------------

-- Reemplaza el viejo @@unique([monthCycleId, personId]): ahora "una persona,
-- un solo equipo por mes" solo aplica a equipos REGULAR. El equipo YOUTH
-- queda deliberadamente fuera de este índice — una persona puede pertenecer
-- a su equipo regular y al equipo de jóvenes el mismo mes (decisión de
-- negocio confirmada).
CREATE UNIQUE INDEX "team_member_one_regular_team_per_person"
  ON "team_member" ("month_cycle_id", "person_id")
  WHERE "team_type" = 'REGULAR';
