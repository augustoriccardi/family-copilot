import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAMILY_ROLES = ["MADRE", "PADRE", "HIJO", "HIJA", "ABUELO", "ABUELA", "OTRO"] as const;

const PRESET_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#FF9F43",
  "#A29BFE",
];

const postSchema = z.object({
  name: z.string().min(1).max(100),
  nickname: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(50).optional()),
  role: z.enum(FAMILY_ROLES),
  isMinor: z.boolean(),
  color: z.string().optional(),
});

async function getHouseholdId(userId: string): Promise<string | null> {
  const member = await prisma.familyMember.findFirst({
    where: { linkedUserId: userId },
    select: { householdId: true },
  });
  if (member) return member.householdId;
  const household = await prisma.household.findFirst({ select: { id: true } });
  return household?.id ?? null;
}

/**
 * GET /api/household/members — returns full member data for the household
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const householdId = await getHouseholdId(session.user.id);
  if (!householdId) {
    return NextResponse.json({ members: [] });
  }

  const members = await prisma.familyMember.findMany({
    where: { householdId },
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
      linkedUserId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Serialize dates
  const serialized = members.map((m) => ({
    ...m,
    birthdate: m.birthdate ? m.birthdate.toISOString() : null,
  }));

  return NextResponse.json({ members: serialized });
}

/**
 * POST /api/household/members — add a new family member (admin-only)
 */
export async function POST(req: NextRequest) {
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
      { error: "Solo el administrador puede agregar miembros" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const count = await prisma.familyMember.count({ where: { householdId: household.id } });
  const color = parsed.data.color ?? PRESET_COLORS[count % PRESET_COLORS.length];

  const member = await prisma.familyMember.create({
    data: {
      householdId: household.id,
      name: parsed.data.name,
      nickname: parsed.data.nickname ?? null,
      role: parsed.data.role,
      isMinor: parsed.data.isMinor,
      color,
    },
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
      linkedUserId: true,
    },
  });

  return NextResponse.json(
    {
      member: { ...member, birthdate: member.birthdate ? member.birthdate.toISOString() : null },
    },
    { status: 201 },
  );
}
