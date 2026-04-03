import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/members?threadId=<threadId>
 * Returns the FamilyMembers for the household linked to the given thread.
 * Falls back to the first household if the thread has no householdId (e.g. new root thread).
 * Used by the web UI member selector to identify who is talking.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");

  let householdId: string | undefined;

  if (threadId) {
    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      select: { householdId: true },
    });
    householdId = thread?.householdId ?? undefined;
  }

  // Fallback: single-household setup — use the first household found
  if (!householdId) {
    const fallback = await prisma.household.findFirst({ select: { id: true } });
    householdId = fallback?.id;
  }

  if (!householdId) {
    return NextResponse.json({ members: [] });
  }

  const members = await prisma.familyMember.findMany({
    where: { householdId },
    select: { id: true, name: true, nickname: true, role: true, color: true, isMinor: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ members });
}
