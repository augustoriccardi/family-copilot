import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/available-members
 * Returns adult FamilyMembers that are not yet linked to any user.
 * Used during onboarding so the new user can claim their profile.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ members: [] }, { status: 401 });
  }

  const household = await prisma.household.findFirst({
    select: { id: true },
  });

  if (!household) {
    return NextResponse.json({ members: [] });
  }

  const members = await prisma.familyMember.findMany({
    where: {
      householdId: household.id,
      isMinor: false,
      linkedUserId: null,
    },
    select: { id: true, name: true, nickname: true, role: true, color: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ members });
}
