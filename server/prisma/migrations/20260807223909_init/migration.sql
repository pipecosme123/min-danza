-- CreateEnum
CREATE TYPE "person_category" AS ENUM ('ELEGIBLE_LIDER', 'COLABORADOR');

-- CreateEnum
CREATE TYPE "team_role" AS ENUM ('LEADER', 'SUPPORT', 'COLLABORATOR');

-- CreateEnum
CREATE TYPE "slot_type" AS ENUM ('FIXED', 'EXTRAORDINARY', 'SPECIAL');

-- CreateEnum
CREATE TYPE "month_status" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "admin_user" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "document_id" TEXT,
    "category" "person_category" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "month_cycle" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "team_count" INTEGER NOT NULL,
    "status" "month_status" NOT NULL DEFAULT 'DRAFT',
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "month_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" TEXT NOT NULL,
    "month_cycle_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_member" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "month_cycle_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "role" "team_role" NOT NULL,
    "manual_override" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uniform" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color_hex" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uniform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekday_uniform" (
    "id" TEXT NOT NULL,
    "weekday" "weekday" NOT NULL,
    "uniform_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekday_uniform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_slot_template" (
    "id" TEXT NOT NULL,
    "weekday" "weekday" NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "teams_needed" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_slot_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_slot" (
    "id" TEXT NOT NULL,
    "month_cycle_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "slot_type" "slot_type" NOT NULL,
    "title" TEXT,
    "teams_needed" INTEGER NOT NULL DEFAULT 1,
    "counts_toward_balance" BOOLEAN NOT NULL DEFAULT true,
    "uniform_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_assignment" (
    "id" TEXT NOT NULL,
    "service_slot_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "month_cycle_id" TEXT NOT NULL,
    "slot_index" INTEGER NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slot_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "special_saturday_member" (
    "id" TEXT NOT NULL,
    "service_slot_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "special_saturday_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_username_key" ON "admin_user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "person_document_id_key" ON "person"("document_id");

-- CreateIndex
CREATE INDEX "person_active_category_idx" ON "person"("active", "category");

-- CreateIndex
CREATE INDEX "person_full_name_idx" ON "person"("full_name");

-- CreateIndex
CREATE INDEX "month_cycle_status_idx" ON "month_cycle"("status");

-- CreateIndex
CREATE UNIQUE INDEX "month_cycle_year_month_key" ON "month_cycle"("year", "month");

-- CreateIndex
CREATE INDEX "team_month_cycle_id_idx" ON "team"("month_cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_month_cycle_id_label_key" ON "team"("month_cycle_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "team_month_cycle_id_order_index_key" ON "team"("month_cycle_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "team_id_month_cycle_id_key" ON "team"("id", "month_cycle_id");

-- CreateIndex
CREATE INDEX "team_member_team_id_role_idx" ON "team_member"("team_id", "role");

-- CreateIndex
CREATE INDEX "team_member_person_id_idx" ON "team_member"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_member_team_id_person_id_key" ON "team_member"("team_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_member_month_cycle_id_person_id_key" ON "team_member"("month_cycle_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniform_name_key" ON "uniform"("name");

-- CreateIndex
CREATE UNIQUE INDEX "weekday_uniform_weekday_key" ON "weekday_uniform"("weekday");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_slot_template_weekday_start_time_key" ON "fixed_slot_template"("weekday", "start_time");

-- CreateIndex
CREATE INDEX "service_slot_month_cycle_id_date_start_time_idx" ON "service_slot"("month_cycle_id", "date", "start_time");

-- CreateIndex
CREATE INDEX "service_slot_month_cycle_id_slot_type_idx" ON "service_slot"("month_cycle_id", "slot_type");

-- CreateIndex
CREATE INDEX "service_slot_month_cycle_id_counts_toward_balance_idx" ON "service_slot"("month_cycle_id", "counts_toward_balance");

-- CreateIndex
CREATE UNIQUE INDEX "service_slot_month_cycle_id_date_start_time_slot_type_key" ON "service_slot"("month_cycle_id", "date", "start_time", "slot_type");

-- CreateIndex
CREATE UNIQUE INDEX "service_slot_id_month_cycle_id_key" ON "service_slot"("id", "month_cycle_id");

-- CreateIndex
CREATE INDEX "slot_assignment_team_id_idx" ON "slot_assignment"("team_id");

-- CreateIndex
CREATE INDEX "slot_assignment_month_cycle_id_team_id_idx" ON "slot_assignment"("month_cycle_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "slot_assignment_service_slot_id_team_id_key" ON "slot_assignment"("service_slot_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "slot_assignment_service_slot_id_slot_index_key" ON "slot_assignment"("service_slot_id", "slot_index");

-- CreateIndex
CREATE INDEX "special_saturday_member_person_id_idx" ON "special_saturday_member"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "special_saturday_member_service_slot_id_person_id_key" ON "special_saturday_member"("service_slot_id", "person_id");

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_month_cycle_id_fkey" FOREIGN KEY ("month_cycle_id") REFERENCES "month_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_month_cycle_id_fkey" FOREIGN KEY ("team_id", "month_cycle_id") REFERENCES "team"("id", "month_cycle_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekday_uniform" ADD CONSTRAINT "weekday_uniform_uniform_id_fkey" FOREIGN KEY ("uniform_id") REFERENCES "uniform"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_slot" ADD CONSTRAINT "service_slot_month_cycle_id_fkey" FOREIGN KEY ("month_cycle_id") REFERENCES "month_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_slot" ADD CONSTRAINT "service_slot_uniform_id_fkey" FOREIGN KEY ("uniform_id") REFERENCES "uniform"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_assignment" ADD CONSTRAINT "slot_assignment_service_slot_id_month_cycle_id_fkey" FOREIGN KEY ("service_slot_id", "month_cycle_id") REFERENCES "service_slot"("id", "month_cycle_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_assignment" ADD CONSTRAINT "slot_assignment_team_id_month_cycle_id_fkey" FOREIGN KEY ("team_id", "month_cycle_id") REFERENCES "team"("id", "month_cycle_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_saturday_member" ADD CONSTRAINT "special_saturday_member_service_slot_id_fkey" FOREIGN KEY ("service_slot_id") REFERENCES "service_slot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_saturday_member" ADD CONSTRAINT "special_saturday_member_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- SQL crudo manual (no expresable en schema.prisma): CHECK constraints e
-- índice único parcial. Ver docs/architecture/phase1-schema-design.md §2.
-- ---------------------------------------------------------------------------

-- I1: como máximo un LEADER por equipo (la existencia de al menos uno la
-- garantiza teamGeneration.service.js).
CREATE UNIQUE INDEX "team_member_one_leader_per_team"
  ON "team_member" ("team_id")
  WHERE "role" = 'LEADER';

-- MonthCycle: mes/año/cantidad de equipos con sentido.
ALTER TABLE "month_cycle"
  ADD CONSTRAINT "month_cycle_month_range"  CHECK ("month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "month_cycle_year_range"   CHECK ("year"  BETWEEN 2000 AND 2200),
  ADD CONSTRAINT "month_cycle_team_count_positive" CHECK ("team_count" >= 1);

-- I4 + I5 + formato de hora.
ALTER TABLE "service_slot"
  ADD CONSTRAINT "service_slot_teams_needed_range" CHECK ("teams_needed" BETWEEN 1 AND 2),
  ADD CONSTRAINT "service_slot_start_time_format"
      CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "service_slot_special_never_counts"
      CHECK ("slot_type" <> 'SPECIAL' OR "counts_toward_balance" = false);

-- I7: tope duro de 2 equipos por slot.
ALTER TABLE "slot_assignment"
  ADD CONSTRAINT "slot_assignment_slot_index_range" CHECK ("slot_index" BETWEEN 0 AND 1);

ALTER TABLE "fixed_slot_template"
  ADD CONSTRAINT "fixed_slot_template_start_time_format"
      CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "fixed_slot_template_teams_needed_range"
      CHECK ("teams_needed" BETWEEN 1 AND 2);
