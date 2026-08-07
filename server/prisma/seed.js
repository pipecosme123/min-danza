// Seed inicial, idempotente (upsert), sin datos de prueba.
// Ver docs/architecture/phase1-schema-design.md §3.
//
// NOTA: este archivo se ejecuta con `node prisma/seed.js` (o `prisma db seed`)
// ANTES de que exista `src/config/env.js` en el ciclo de arranque normal de
// la app, así que valida sus propias variables de entorno aquí mismo en vez
// de importar ese módulo (evita un ciclo de dependencias prisma -> src).

import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BCRYPT_COST = 12;

async function main() {
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;

  if (!ADMIN_PASSWORD) {
    throw new Error(
      "ADMIN_PASSWORD no está definida en el entorno. Abortando seed: " +
        "nunca se siembra un AdminUser con contraseña por defecto."
    );
  }
  if (!ADMIN_USERNAME) {
    throw new Error("ADMIN_USERNAME no está definida en el entorno. Abortando seed.");
  }

  // 1. AdminUser único.
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_COST);
  const admin = await prisma.adminUser.upsert({
    where: { username: ADMIN_USERNAME },
    update: { passwordHash },
    create: {
      username: ADMIN_USERNAME,
      passwordHash,
      displayName: "Administrador",
    },
  });
  console.log(`AdminUser listo: ${admin.username}`);

  // 2. Uniformes base.
  const uniformA = await prisma.uniform.upsert({
    where: { name: "Uniforme A" },
    update: {},
    create: { name: "Uniforme A" },
  });
  const uniformB = await prisma.uniform.upsert({
    where: { name: "Uniforme B" },
    update: {},
    create: { name: "Uniforme B" },
  });
  console.log("Uniformes listos: Uniforme A, Uniforme B");

  // 3. Config de uniforme por día de la semana.
  await prisma.weekdayUniform.upsert({
    where: { weekday: "WEDNESDAY" },
    update: { uniformId: uniformA.id },
    create: { weekday: "WEDNESDAY", uniformId: uniformA.id },
  });
  await prisma.weekdayUniform.upsert({
    where: { weekday: "SUNDAY" },
    update: { uniformId: uniformB.id },
    create: { weekday: "SUNDAY", uniformId: uniformB.id },
  });
  console.log("WeekdayUniform listo: miércoles -> Uniforme A, domingo -> Uniforme B");

  // 4. Turnos fijos semanales.
  const fixedSlots = [
    { weekday: "WEDNESDAY", startTime: "17:00" },
    { weekday: "WEDNESDAY", startTime: "19:00" },
    { weekday: "SUNDAY", startTime: "08:00" },
    { weekday: "SUNDAY", startTime: "10:30" },
  ];
  for (const slot of fixedSlots) {
    await prisma.fixedSlotTemplate.upsert({
      where: { weekday_startTime: { weekday: slot.weekday, startTime: slot.startTime } },
      update: {},
      create: { ...slot, teamsNeeded: 1 },
    });
  }
  console.log("FixedSlotTemplate listo: 4 turnos fijos (miércoles 17:00/19:00, domingo 08:00/10:30)");
}

main()
  .catch((err) => {
    console.error("Seed falló:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
