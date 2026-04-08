import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEZONES = [
  "America/Montevideo",
  "America/Buenos_Aires",
  "America/Santiago",
  "America/Bogota",
  "America/Lima",
  "America/Mexico_City",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Madrid",
  "Europe/London",
];

const memberSchema = z.object({
  name: z.string().min(1).max(100),
  nickname: z.string().max(50).optional(),
  role: z.enum(["MADRE", "PADRE", "HIJO", "HIJA", "ABUELO", "ABUELA", "OTRO"]),
  isMinor: z.boolean(),
  color: z.string().optional(),
  birthdate: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .optional()
      .transform((v) => (v ? new Date(v) : undefined)),
  ),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
  whatsappPhone: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(30).optional()),
  schoolName: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(100).optional()),
});

const setupSchema = z.object({
  householdName: z.string().min(1).max(100),
  timezone: z.string().refine((tz) => TIMEZONES.includes(tz), { message: "Timezone inválida" }),
  members: z.array(memberSchema).min(1).max(20),
  selfIndex: z.number().int().min(0),
});

/**
 * POST /api/auth/setup
 * Creates the household, all family members, and links the admin user to one member.
 * Only valid when no household exists yet.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Guard: only if no household exists yet
  const existingCount = await prisma.household.count();
  if (existingCount > 0) {
    return NextResponse.json({ error: "El hogar ya fue configurado" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { householdName, timezone, members, selfIndex } = parsed.data;

  if (selfIndex >= members.length) {
    return NextResponse.json({ error: "selfIndex fuera de rango" }, { status: 422 });
  }
  if (members[selfIndex].isMinor) {
    return NextResponse.json(
      { error: "El perfil que elegís como tuyo no puede ser menor" },
      { status: 422 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const household = await tx.household.create({
      data: {
        name: householdName,
        timezone,
        ownerUserId: session.user!.id,
      },
    });

    const createdMembers = await Promise.all(
      members.map((m) =>
        tx.familyMember.create({
          data: {
            householdId: household.id,
            name: m.name,
            nickname: m.nickname ?? null,
            role: m.role,
            isMinor: m.isMinor,
            color: m.color ?? null,
            birthdate: m.birthdate ?? null,
            email: m.email ?? null,
            whatsappPhone: m.whatsappPhone ?? null,
            schoolName: m.schoolName ?? null,
            linkedUserId: null,
          },
          select: { id: true },
        }),
      ),
    );

    // Link the chosen member to the admin user
    await tx.familyMember.update({
      where: { id: createdMembers[selfIndex].id },
      data: { linkedUserId: session.user!.id },
    });

    return { householdId: household.id, memberId: createdMembers[selfIndex].id };
  });

  return NextResponse.json(result, { status: 201 });
}
