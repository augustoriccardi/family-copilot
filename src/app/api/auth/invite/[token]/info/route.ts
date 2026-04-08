import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/invite/[token]/info
 * Public endpoint. Returns display info about an invitation (no sensitive data).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    select: {
      email: true,
      expiresAt: true,
      acceptedAt: true,
      member: {
        select: {
          name: true,
          role: true,
          household: { select: { name: true } },
        },
      },
      invitedBy: { select: { name: true } },
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

  return NextResponse.json({
    email: invitation.email,
    member: invitation.member,
    household: invitation.member.household,
    invitedBy: invitation.invitedBy,
  });
}
