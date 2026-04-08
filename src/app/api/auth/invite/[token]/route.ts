import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/invite/[token]/accept
 * Accepts an invitation: links the session user to the FamilyMember.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { token } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    select: {
      id: true,
      email: true,
      acceptedAt: true,
      expiresAt: true,
      memberId: true,
      member: { select: { linkedUserId: true, isMinor: true, householdId: true } },
    },
  });

  if (!invitation) {
    return NextResponse.json({ error: "Invitación no encontrada" }, { status: 404 });
  }
  if (invitation.acceptedAt) {
    return NextResponse.json({ error: "Esta invitación ya fue usada" }, { status: 409 });
  }
  if (invitation.expiresAt < new Date()) {
    return NextResponse.json({ error: "La invitación expiró" }, { status: 410 });
  }
  if (invitation.member.linkedUserId) {
    return NextResponse.json({ error: "Este perfil ya está vinculado" }, { status: 409 });
  }

  // Ensure the logged-in user's email matches the invite
  const sessionUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });
  if (sessionUser?.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Esta invitación es para otro email. Iniciá sesión con " + invitation.email },
      { status: 403 },
    );
  }

  // Link the member and mark invitation as accepted in one transaction
  await prisma.$transaction([
    prisma.familyMember.update({
      where: { id: invitation.memberId },
      data: { linkedUserId: session.user.id },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    }),
    prisma.calendarConnection.updateMany({
      where: { userId: session.user.id, memberId: null },
      data: { memberId: invitation.memberId },
    }),
  ]);

  // Set ownerUserId if household has none
  const household = await prisma.household.findUnique({
    where: { id: invitation.member.householdId },
    select: { ownerUserId: true },
  });
  if (!household?.ownerUserId) {
    await prisma.household.update({
      where: { id: invitation.member.householdId },
      data: { ownerUserId: session.user.id },
    });
  }

  return NextResponse.json({ ok: true });
}
