import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";
import { z } from "zod";
import { sendEmail } from "@/lib/email/email-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inviteSchema = z.object({
  email: z.string().email(),
  memberId: z.string().cuid(),
});

/**
 * POST /api/auth/invite
 * Admin-only. Creates an invitation for a FamilyMember and sends an email.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Only the household owner (admin) can invite
  const household = await prisma.household.findFirst({
    where: { ownerUserId: session.user.id },
    select: { id: true, name: true },
  });
  if (!household) {
    return NextResponse.json(
      { error: "Solo el administrador puede enviar invitaciones" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 422 });
  }

  const { email, memberId } = parsed.data;

  const member = await prisma.familyMember.findUnique({
    where: { id: memberId, householdId: household.id },
    select: { id: true, name: true, role: true, isMinor: true, linkedUserId: true },
  });

  if (!member) {
    return NextResponse.json({ error: "Miembro no encontrado" }, { status: 404 });
  }
  if (member.linkedUserId) {
    return NextResponse.json(
      { error: "Este perfil ya está vinculado a una cuenta" },
      { status: 409 },
    );
  }

  // Invalidate any previous pending invitation for the same member
  await prisma.invitation.deleteMany({
    where: { memberId, acceptedAt: null },
  });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const invitation = await prisma.invitation.create({
    data: {
      email,
      memberId,
      invitedById: session.user.id,
      expiresAt,
    },
  });

  const inviteUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/invite/${invitation.token}`;
  const inviterName = session.user.name ?? "Un integrante del hogar";

  // Send invitation email — non-fatal: if it fails the invite is still created
  try {
    await sendEmail({
      to: email,
      subject: `${inviterName} te invitó a ${household.name} en Family Copilot`,
      text: [
        `Hola,`,
        ``,
        `${inviterName} te invitó a unirte al hogar "${household.name}" en Family Copilot como ${member.name}.`,
        ``,
        `Usá este enlace para aceptar la invitación (válido por 7 días):`,
        inviteUrl,
        ``,
        `Si no esperabas este email, podés ignorarlo.`,
      ].join("\n"),
    });
  } catch (emailErr) {
    console.error("[invite] Failed to send invitation email:", emailErr);
  }

  console.log(`[invite] Invitation created: ${inviteUrl}`);

  return NextResponse.json({ ok: true, inviteUrl, token: invitation.token });
}

/**
 * GET /api/auth/invite
 * Admin-only. Returns all pending invitations for the household.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ invitations: [] }, { status: 401 });
  }

  const household = await prisma.household.findFirst({
    where: { ownerUserId: session.user.id },
    select: { id: true },
  });
  if (!household) {
    return NextResponse.json({ invitations: [] });
  }

  const invitations = await prisma.invitation.findMany({
    where: { member: { householdId: household.id }, acceptedAt: null },
    select: {
      id: true,
      email: true,
      expiresAt: true,
      createdAt: true,
      member: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ invitations });
}

/**
 * DELETE /api/auth/invite?id=<invitationId>
 * Admin-only. Cancels a pending invitation.
 */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  const household = await prisma.household.findFirst({
    where: { ownerUserId: session.user.id },
    select: { id: true },
  });
  if (!household) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  await prisma.invitation.deleteMany({
    where: { id, member: { householdId: household.id } },
  });

  return NextResponse.json({ ok: true });
}
