import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/linked-member — returns the FamilyMember linked to the session user + whether any household exists */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ member: null, householdExists: false }, { status: 401 });
  }

  const [member, householdCount] = await Promise.all([
    prisma.familyMember.findFirst({
      where: { linkedUserId: session.user.id },
      select: { id: true, name: true, nickname: true, role: true, color: true, isMinor: true },
    }),
    prisma.household.count(),
  ]);

  return NextResponse.json({ member, householdExists: householdCount > 0 });
}

const linkSchema = z.object({ memberId: z.string().cuid() });

/**
 * POST /api/auth/linked-member
 * Links the session user to a FamilyMember.
 * Only adults (isMinor=false) can be linked.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "memberId inválido" }, { status: 422 });
  }

  const { memberId } = parsed.data;

  const member = await prisma.familyMember.findUnique({
    where: { id: memberId },
    select: { id: true, isMinor: true, linkedUserId: true, householdId: true },
  });

  if (!member) {
    return NextResponse.json({ error: "Miembro no encontrado" }, { status: 404 });
  }
  if (member.isMinor) {
    return NextResponse.json(
      { error: "Los menores no pueden tener cuenta propia" },
      { status: 403 },
    );
  }
  if (member.linkedUserId && member.linkedUserId !== session.user.id) {
    return NextResponse.json(
      { error: "Este perfil ya está vinculado a otra cuenta" },
      { status: 409 },
    );
  }

  // Link the member to this user
  await prisma.familyMember.update({
    where: { id: memberId },
    data: { linkedUserId: session.user.id },
  });

  // If the household has no owner yet, set this user as owner
  const household = await prisma.household.findUnique({
    where: { id: member.householdId },
    select: { ownerUserId: true },
  });
  if (!household?.ownerUserId) {
    await prisma.household.update({
      where: { id: member.householdId },
      data: { ownerUserId: session.user.id },
    });
  }

  // Also backfill memberId on any CalendarConnection linked to this user
  await prisma.calendarConnection.updateMany({
    where: { userId: session.user.id, memberId: null },
    data: { memberId },
  });

  return NextResponse.json({ ok: true });
}
