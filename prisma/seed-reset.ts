/**
 * Borra todos los datos creados por el seed (Household "Familia Test" y todo lo relacionado).
 * También limpia los checkpoints de LangGraph para los threads del household.
 *
 * Uso:
 *   pnpm prisma:seed:reset          → borra los datos de seed + checkpoints huérfanos
 *   pnpm prisma:db:reset            → borra TODA la DB y re-seedea
 */

import { PrismaClient } from "@prisma/client";
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const household = await prisma.household.findFirst({
    where: { name: "Familia Test" },
  });

  if (!household) {
    console.log('ℹ️  No existe el household "Familia Test" — nada que borrar.');
    return;
  }

  // Recoger TODOS los thread IDs para limpiar sus checkpoints
  const threads = await prisma.thread.findMany({ select: { id: true } });
  const threadIds = threads.map((t) => t.id);

  // Cascade borra todo lo relacionado (members, events, reminders, etc.)
  await prisma.household.delete({ where: { id: household.id } });

  // Borrar todos los threads
  await prisma.thread.deleteMany({});

  console.log(`✅ Household "Familia Test" (${household.id}) y todos sus datos eliminados.`);

  // Limpiar checkpoints de LangGraph para esos thread IDs
  if (threadIds.length > 0) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const placeholders = threadIds.map((_, i) => `$${i + 1}`).join(", ");
      const [r1, r2, r3] = await Promise.all([
        pool.query(`DELETE FROM checkpoint_blobs WHERE thread_id IN (${placeholders})`, threadIds),
        pool.query(`DELETE FROM checkpoint_writes WHERE thread_id IN (${placeholders})`, threadIds),
        pool.query(`DELETE FROM checkpoints WHERE thread_id IN (${placeholders})`, threadIds),
      ]);
      console.log(
        `🧹 Checkpoints eliminados: ${r3.rowCount} checkpoints, ${r1.rowCount} blobs, ${r2.rowCount} writes`,
      );
    } finally {
      await pool.end();
    }
  }

  console.log('   Ejecutá "pnpm prisma:seed" para volver a crear los datos de prueba.');
}

main()
  .catch((e) => {
    console.error("❌ Reset falló:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
