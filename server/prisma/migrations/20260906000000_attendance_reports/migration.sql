-- ---------------------------------------------------------------------------
-- Fase 9 · Reportes de asistencia por líderes de equipo.
-- Contrato: docs/architecture/phase9-attendance-reports-contract.md
--
--   1) leader_account          -- cuenta de acceso del líder (por Person).
--   2) attendance_report       -- un reporte por (servicio, equipo).
--   3) attendance_entry        -- estado de cada integrante del equipo.
--   4) attendance_support      -- apoyos voluntarios.
--
-- Escrita a mano (no `prisma migrate dev`: el entorno de esta sesión es no
-- interactivo), siguiendo el estilo de las migraciones previas.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "attendance_report_status" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "attendance_entry_status" AS ENUM ('ASISTIO', 'NO_ASISTIO_CON_EXCUSA', 'NO_ASISTIO_SIN_EXCUSA', 'REMPLAZADO', 'CAMBIO');

-- CreateTable
CREATE TABLE "leader_account" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leader_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leader_account_person_id_key" ON "leader_account"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "leader_account_username_key" ON "leader_account"("username");

-- AddForeignKey
ALTER TABLE "leader_account" ADD CONSTRAINT "leader_account_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "attendance_report" (
    "id" TEXT NOT NULL,
    "service_slot_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "month_cycle_id" TEXT NOT NULL,
    "status" "attendance_report_status" NOT NULL DEFAULT 'DRAFT',
    "general_notes" TEXT,
    "submitted_at" TIMESTAMP(3),
    "reopened_at" TIMESTAMP(3),
    "created_by_leader_id" TEXT,
    "last_edited_by_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_report_service_slot_id_team_id_key" ON "attendance_report"("service_slot_id", "team_id");

-- CreateIndex
CREATE INDEX "attendance_report_month_cycle_id_status_idx" ON "attendance_report"("month_cycle_id", "status");

-- CreateIndex
CREATE INDEX "attendance_report_team_id_idx" ON "attendance_report"("team_id");

-- AddForeignKey (compuesta: un equipo de un mes nunca se liga a un slot de otro mes)
ALTER TABLE "attendance_report" ADD CONSTRAINT "attendance_report_service_slot_id_month_cycle_id_fkey"
    FOREIGN KEY ("service_slot_id", "month_cycle_id") REFERENCES "service_slot"("id", "month_cycle_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_report" ADD CONSTRAINT "attendance_report_team_id_month_cycle_id_fkey"
    FOREIGN KEY ("team_id", "month_cycle_id") REFERENCES "team"("id", "month_cycle_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "attendance_entry" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "status" "attendance_entry_status",
    "covered_by_person_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_entry_report_id_person_id_key" ON "attendance_entry"("report_id", "person_id");

-- CreateIndex
CREATE INDEX "attendance_entry_report_id_idx" ON "attendance_entry"("report_id");

-- covered_by obligatorio SII el estado es REMPLAZADO/CAMBIO; en cualquier
-- otro caso (incluido status NULL) covered_by debe ser NULL.
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_covered_by_consistency"
    CHECK (
      CASE
        WHEN "status" IN ('REMPLAZADO', 'CAMBIO') THEN "covered_by_person_id" IS NOT NULL
        ELSE "covered_by_person_id" IS NULL
      END
    );

-- quien cubre nunca puede ser el mismo integrante ausente.
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_covered_by_distinct"
    CHECK ("covered_by_person_id" IS DISTINCT FROM "person_id");

-- AddForeignKey
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "attendance_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_entry" ADD CONSTRAINT "attendance_entry_covered_by_person_id_fkey"
    FOREIGN KEY ("covered_by_person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "attendance_support" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_support_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_support_report_id_person_id_key" ON "attendance_support"("report_id", "person_id");

-- CreateIndex
CREATE INDEX "attendance_support_report_id_idx" ON "attendance_support"("report_id");

-- AddForeignKey
ALTER TABLE "attendance_support" ADD CONSTRAINT "attendance_support_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "attendance_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_support" ADD CONSTRAINT "attendance_support_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
