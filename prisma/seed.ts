/**
 * Seed script — datos de prueba para Family Copilot
 *
 * Crea:
 *   - 1 Household "Familia Test"
 *   - 5 FamilyMember (Augusto, Pilar, Violeta, Paulina, Alma)
 *   - HouseholdPreferences
 *   - FamilyConstraints de ejemplo (alergia, regla de horario)
 *   - 5 PantryItems
 *   - 1 Thread vinculado al hogar
 *   - MemberCalendar (calendarios de Google para adultos)
 *   - 1 Document de ejemplo (comunicado escolar desde prisma/fixtures/)
 *
 * Uso:
 *   pnpm prisma:seed
 *
 * Idempotente: si el hogar "Familia Test" ya existe lo omite.
 */

import { config } from "dotenv";
import { PrismaClient, FamilyRole, ConstraintType } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { uploadFile } from "../src/lib/storage/upload";

config(); // carga .env para leer vars de Google Calendar

const prisma = new PrismaClient();

async function main() {
  // ── Household ─────────────────────────────────────────────────────────────
  const existing = await prisma.household.findFirst({
    where: { name: "Familia Test" },
  });

  if (existing) {
    console.log(`✅ Household "Familia Test" ya existe (id: ${existing.id}) — seed omitido.`);
    console.log("   Ejecutá 'pnpm prisma:seed:reset' para borrar y re-seedear.");
    return;
  }

  const household = await prisma.household.create({
    data: {
      name: "Familia Test",
      timezone: "America/Montevideo",
      currency: "UYU",
    },
  });
  console.log(`✅ Household creado: ${household.id}`);

  // ── Family Members ────────────────────────────────────────────────────────
  const augusto = await prisma.familyMember.create({
    data: {
      householdId: household.id,
      name: "Augusto",
      nickname: "Papá",
      role: FamilyRole.PADRE,
      isMinor: false,
      color: "#3B82F6", // azul
      // Reemplazá con un número real para probar notificaciones WhatsApp
      // whatsappPhone: "59899123456",
    },
  });

  const pilar = await prisma.familyMember.create({
    data: {
      householdId: household.id,
      name: "Pilar",
      nickname: "Mamá",
      role: FamilyRole.MADRE,
      isMinor: false,
      color: "#EC4899", // rosa
    },
  });

  const violeta = await prisma.familyMember.create({
    data: {
      householdId: household.id,
      name: "Violeta",
      nickname: "Viole",
      role: FamilyRole.HIJA,
      isMinor: true,
      color: "#8B5CF6", // violeta
      birthdate: new Date("2012-10-31"),
      schoolName: "The Bristish Schools",
    },
  });

  const paulina = await prisma.familyMember.create({
    data: {
      householdId: household.id,
      name: "Paulina",
      nickname: "Pau",
      role: FamilyRole.HIJA,
      isMinor: true,
      color: "#F59E0B", // ámbar
      birthdate: new Date("2015-08-13"),
      schoolName: "Saint Patrick's College",
    },
  });

  const alma = await prisma.familyMember.create({
    data: {
      householdId: household.id,
      name: "Alma",
      nickname: "Almita",
      role: FamilyRole.HIJA,
      isMinor: true,
      color: "#10B981", // esmeralda
      birthdate: new Date("2023-06-29"),
      schoolName: "The Bristish Schools",
    },
  });

  console.log(
    `✅ Miembros creados: ${augusto.name} (${augusto.id}), ${pilar.name} (${pilar.id}), ${violeta.name} (${violeta.id}), ${paulina.name} (${paulina.id}), ${alma.name} (${alma.id})`,
  );

  // ── Preferences ───────────────────────────────────────────────────────────
  await prisma.householdPreferences.create({
    data: {
      householdId: household.id,
      preferredSupermarket: "Tienda Inglesa",
      shoppingDay: "viernes",
      mealStyle: "casero, variado",
      dietRules: ["sin gluten para Paulina"],
    },
  });
  console.log("✅ Preferencias creadas");

  // ── Constraints ───────────────────────────────────────────────────────────
  await prisma.familyConstraint.createMany({
    data: [
      {
        householdId: household.id,
        memberId: paulina.id,
        type: ConstraintType.ALLERGY,
        key: "gluten",
        value: "intolerancia al gluten — no consumir trigo, cebada, centeno",
      },
      {
        householdId: household.id,
        memberId: paulina.id,
        type: ConstraintType.SCHEDULE_RULE,
        key: "natacion",
        value: "Martes y jueves 17:00-18:30 — Natación Club Neptuno",
      },
      {
        householdId: household.id,
        memberId: violeta.id,
        type: ConstraintType.SCHEDULE_RULE,
        key: "futbol",
        value: "Sábados 10:00-12:00 — Fútbol Club Atlético",
      },
    ],
  });
  console.log("✅ Restricciones creadas");

  // ── Pantry Items ──────────────────────────────────────────────────────────
  await prisma.pantryItem.createMany({
    data: [
      {
        householdId: household.id,
        itemName: "Arroz",
        quantity: 1,
        unit: "kg",
        category: "cereales",
      },
      {
        householdId: household.id,
        itemName: "Huevos",
        quantity: 12,
        unit: "unidades",
        category: "proteínas",
      },
      {
        householdId: household.id,
        itemName: "Leche",
        quantity: 2,
        unit: "litros",
        category: "lácteos",
      },
      {
        householdId: household.id,
        itemName: "Tomates",
        quantity: 4,
        unit: "unidades",
        category: "verduras",
      },
      {
        householdId: household.id,
        itemName: "Aceite de oliva",
        quantity: 0.5,
        unit: "litros",
        category: "aceites",
      },
    ],
  });
  console.log("✅ Items de despensa creados");

  // ── Thread vinculado al hogar ─────────────────────────────────────────────
  const thread = await prisma.thread.create({
    data: {
      title: "Conversación familiar",
      householdId: household.id,
    },
  });
  console.log(`✅ Thread creado: ${thread.id}`);

  // ── MemberCalendar: calendarios de Google para adultos ───────────────────
  // Estas filas permiten que el agente sepa a qué calendarId de Google sincronizar.
  // "primary" es el alias de Google para el calendario principal del usuario.
  // PERSONALIZAR: reemplazá "primary" con el ID real del calendario familiar compartido
  // si querés que los eventos de familia vayan a un calendar separado.
  //
  // Para obtener el ID de un calendario:
  //   Google Calendar → Configuración del calendario → "Integración de calendario"
  //   → copiá el "ID del calendario" (ej: "familia@group.calendar.google.com")
  //
  // Si el MCP de Google Calendar NO está configurado, estos registros no causan error
  // pero el sync no va a ocurrir (el agente usará solo la app).

  // GOOGLE_CALENDAR_ID   = calendar personal del titular del token OAuth (Augusto)
  //                         Valor por defecto: "primary" (el calendar principal de su cuenta)
  //                         Cómo obtener el ID real: Google Calendar → engranaje → Configuración del calendario
  //                         → sección "Integración de calendario" → copiar "ID del calendario"
  //
  // GOOGLE_FAMILY_CALENDAR_ID = calendar compartido familiar (opcional)
  //                         Ejemplo: "c_abc123@group.calendar.google.com"
  //                         Si no está configurado, los eventos familiares van al calendar personal.
  const personalCalendarId = process.env.GOOGLE_CALENDAR_ID ?? "primary";
  const familyCalendarId = process.env.GOOGLE_FAMILY_CALENDAR_ID;

  // Calendar personal de Augusto (token global GOOGLE_REFRESH_TOKEN)
  await prisma.memberCalendar.create({
    data: {
      householdMemberId: augusto.id,
      type: "PERSONAL",
      googleCalendarId: personalCalendarId,
      displayName: "Calendario de Augusto",
      isPrimary: true,
    },
  });

  // Calendar personal de Pilar — solo si tiene token propio configurado.
  // Para activar: pnpm google-calendar:token (iniciar sesión con la cuenta de Pilar)
  // Luego agregar al .env:
  //   PILAR_GOOGLE_REFRESH_TOKEN=<token>
  //   PILAR_GOOGLE_CALENDAR_ID=primary  (o el ID específico de su calendar)
  const pilarRefreshToken = process.env.PILAR_GOOGLE_REFRESH_TOKEN;
  const pilarCalendarId = process.env.PILAR_GOOGLE_CALENDAR_ID;
  if (pilarRefreshToken && pilarCalendarId) {
    const pilarConnection = await prisma.calendarConnection.create({
      data: {
        memberId: pilar.id,
        provider: "google",
        providerEmail: pilarCalendarId === "primary" ? "pilar@personal" : pilarCalendarId,
        accessToken: "",
        refreshToken: pilarRefreshToken,
      },
    });
    await prisma.memberCalendar.create({
      data: {
        householdMemberId: pilar.id,
        calendarConnectionId: pilarConnection.id,
        type: "PERSONAL",
        googleCalendarId: pilarCalendarId,
        displayName: "Calendario de Pilar",
        isPrimary: true,
      },
    });
    console.log(`✅ Calendario personal de Pilar creado → ${pilarCalendarId}`);
  } else {
    console.log(
      `⏭  PILAR_GOOGLE_REFRESH_TOKEN no configurado — Pilar sin calendar personal (sus eventos irán al familiar compartido)`,
    );
  }

  // ── Calendarios familiares compartidos ───────────────────────────────────
  // Cuando GOOGLE_FAMILY_CALENDAR_ID está configurado, TODOS los miembros del hogar
  // reciben una fila FAMILY_SHARED apuntando al mismo calendar compartido.
  // Esto garantiza que los eventos de hijos/hijas (Violeta, Paulina, Alma) y de Pilar
  // siempre sincronicen al Google Calendar familiar, aunque no tengan token OAuth propio.
  //
  // El token OAuth de Augusto es el único necesario: él administra el calendar compartido
  // y el agente escribe eventos allí en nombre de cualquier miembro.
  //
  // Pilar NO recibe MemberCalendar PERSONAL para evitar que sus eventos personales
  // vayan al calendar de Augusto (mismo token → mismo "primary" = bug).
  // Para activar sync personal de Pilar: ver comentarios en scripts/get-google-token.mjs
  if (familyCalendarId) {
    const allMembers = [augusto, pilar, violeta, paulina, alma];
    await prisma.memberCalendar.createMany({
      data: allMembers.map((m) => ({
        householdMemberId: m.id,
        type: "FAMILY_SHARED" as const,
        googleCalendarId: familyCalendarId,
        displayName: "Calendario Familia",
        isPrimary: false,
      })),
    });
    console.log(
      `✅ Calendarios FAMILY_SHARED creados para todos los miembros → ${familyCalendarId}`,
    );
  } else {
    console.log(
      `⏭  GOOGLE_FAMILY_CALENDAR_ID no configurado — sin calendar compartido (eventos familiares van al personal de Augusto)`,
    );
  }

  console.log(`✅ Calendarios creados: Augusto PERSONAL (${personalCalendarId})`);

  // ── Document de ejemplo (Biblia Reina Valera 1960) ────────────────────────
  const pdfPath = join(__dirname, "fixtures", "biblia-reina-valera-1960.pdf");
  const pdfBuffer = readFileSync(pdfPath);
  const fileKey = `documents/${household.id}/biblia-reina-valera-1960.pdf`;
  const fileUrl = await uploadFile(
    pdfBuffer,
    fileKey,
    "application/pdf",
    "biblia-reina-valera-1960.pdf",
  );

  await prisma.document.create({
    data: {
      householdId: household.id,
      title: "Biblia Reina Valera 1960",
      fileUrl,
      fileKey,
      mimeType: "application/pdf",
      subject: "Biblia — Reina Valera 1960",
      source: "seed",
    },
  });
  console.log(`✅ Document creado: Biblia Reina Valera 1960 (${fileKey})`);

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────");
  console.log("🏠 Household ID:", household.id);
  console.log("🧵 Thread ID:   ", thread.id);
  console.log("👨 Augusto ID:  ", augusto.id);
  console.log("👩 Pilar ID:    ", pilar.id);
  console.log("👧 Violeta ID:  ", violeta.id);
  console.log("👧 Paulina ID:  ", paulina.id);
  console.log("👶 Alma ID:     ", alma.id);
  console.log("─────────────────────────────────────────");
  console.log("\n⚡ Abrí el Thread en http://localhost:3000/thread/" + thread.id);
  console.log("   O seleccioná el thread desde la UI (el threadId ya está vinculado al hogar).\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed falló:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
