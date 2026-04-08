import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/google/member-calendars/[id]
 * Removes a MemberCalendar mapping. Only the linked member's own rows can be deleted.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;

  const linked = await prisma.familyMember.findFirst({
    where: { linkedUserId: session.user.id },
    select: { id: true },
  });
  if (!linked) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const row = await prisma.memberCalendar.findUnique({
    where: { id },
    select: { householdMemberId: true },
  });
  if (!row || row.householdMemberId !== linked.id) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  await prisma.memberCalendar.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
