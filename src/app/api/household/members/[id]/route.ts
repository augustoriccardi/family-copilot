import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAMILY_ROLES = ["MADRE", "PADRE", "HIJO", "HIJA", "ABUELO", "ABUELA", "OTRO"] as const;

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  nickname: z.preprocess((v) => (v === "" ? null : v), z.string().max(50).nullable().optional()),
  role: z.enum(FAMILY_ROLES).optional(),
  isMinor: z.boolean().optional(),
  color: z.string().optional(),
  birthdate: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v ? new Date(v) : null)),
  ),
  email: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().email("Email inválido").nullable().optional(),
  ),
  whatsappPhone: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().max(30).nullable().optional(),
  ),
  schoolName: z.preprocess((v) => (v === "" ? null : v), z.string().max(100).nullable().optional()),
  notes: z.preprocess((v) => (v === "" ? null : v), z.string().max(500).nullable().optional()),
});

async function getHouseholdForUser(userId: string) {
  const member = await prisma.familyMember.findFirst({
    where: { linkedUserId: userId },
    select: { householdId: true },
  });
  if (!member) {
    const household = await prisma.household.findFirst({ select: { id: true } });
    return household?.id;
  }
  return member.householdId;
}

/**
 * PATCH /api/household/members/[id]
 * Any authenticated user can edit a member in their household.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const householdId = await getHouseholdForUser(session.user.id);
  if (!householdId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const existing = await prisma.familyMember.findUnique({
    where: { id },
    select: { householdId: true },
  });
  if (!existing || existing.householdId !== householdId) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
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

  const updated = await prisma.familyMember.update({
    where: { id },
    data: parsed.data,
    select: {
      id: true,
      name: true,
      nickname: true,
      role: true,
      isMinor: true,
      color: true,
      birthdate: true,
      email: true,
      whatsappPhone: true,
      schoolName: true,
      notes: true,
      linkedUserId: true,
    },
  });

  return NextResponse.json({ member: updated });
}

/**
 * DELETE /api/household/members/[id]
 * Admin-only. Removes a family member (only if unlinked).
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;

  const household = await prisma.household.findFirst({
    where: { ownerUserId: session.user.id },
    select: { id: true },
  });
  if (!household) {
    return NextResponse.json(
      { error: "Solo el administrador puede eliminar miembros" },
      { status: 403 },
    );
  }

  const member = await prisma.familyMember.findUnique({
    where: { id },
    select: { householdId: true, linkedUserId: true },
  });
  if (!member || member.householdId !== household.id) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (member.linkedUserId) {
    return NextResponse.json(
      { error: "No se puede eliminar un miembro con cuenta vinculada" },
      { status: 409 },
    );
  }

  await prisma.familyMember.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
