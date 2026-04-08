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

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z
    .string()
    .refine((tz) => TIMEZONES.includes(tz), { message: "Timezone inválida" })
    .optional(),
});

/**
 * GET /api/household — returns the household for the current user
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const household = await prisma.household.findFirst({
    select: { id: true, name: true, timezone: true, ownerUserId: true },
  });

  if (!household) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    household,
    isOwner: household.ownerUserId === session.user.id,
  });
}

/**
 * PATCH /api/household — admin-only, updates name/timezone
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const household = await prisma.household.findFirst({
    where: { ownerUserId: session.user.id },
    select: { id: true },
  });
  if (!household) {
    return NextResponse.json(
      { error: "Solo el administrador puede editar el hogar" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const updated = await prisma.household.update({
    where: { id: household.id },
    data: parsed.data,
    select: { id: true, name: true, timezone: true },
  });

  return NextResponse.json({ household: updated });
}
