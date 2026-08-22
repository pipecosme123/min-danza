-- ---------------------------------------------------------------------------
-- Pool "Adulto mayor": atributo independiente de `category` e independiente
-- de `isJoven`, repartido equitativamente en el sorteo de equipos igual que
-- apoyo/colaboradores. Ver C:\Users\Usuario\.claude\plans\keen-moseying-lake.md
-- §1.
-- ---------------------------------------------------------------------------

-- Escrito a mano (mismo motivo que las migraciones previas: `prisma migrate
-- dev` exige confirmación interactiva, no disponible en esta sesión).

-- AlterTable
ALTER TABLE "person" ADD COLUMN "is_adulto_mayor" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "person_active_is_adulto_mayor_idx" ON "person"("active", "is_adulto_mayor");

-- Exclusión mutua: una persona no puede ser joven y adulto mayor a la vez.
-- Defensa en profundidad -- la app ya lo impide en people.service.js, esto
-- protege contra cualquier escritura que se salte la capa de aplicación.
ALTER TABLE "person"
  ADD CONSTRAINT "person_joven_adulto_mayor_exclusive"
      CHECK (NOT ("is_joven" = true AND "is_adulto_mayor" = true));
