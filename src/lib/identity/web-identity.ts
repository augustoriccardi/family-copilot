/**
 * Web channel identity resolver.
 *
 * Resolves WHO is talking in the web UI and which household they belong to.
 *
 * ─── CURRENT IMPLEMENTATION (no auth) ──────────────────────────────────────
 * Identity comes from the UI member selector (SettingsPanel → localStorage →
 * query params callerId/callerName/callerRole). The household is looked up
 * from the thread in the DB, falling back to the first household.
 *
 * ─── WHEN AUTH IS ADDED ─────────────────────────────────────────────────────
 * Replace the body of this function with session-based resolution:
 *
 *   // NextAuth example:
 *   const session = await getServerSession(authOptions);
 *   const userId = session?.user?.id;
 *   if (!userId) return { householdId };  // unauthenticated — household only
 *
 *   const member = await prisma.familyMember.findFirst({
 *     where: { linkedUserId: userId },
 *     select: { id: true, name: true, role: true, householdId: true },
 *   });
 *   return {
 *     householdId: member?.householdId ?? householdId,
 *     callerId: member?.id,
 *     callerName: member?.name,
 *     callerRole: member?.role,
 *   };
 *
 * The rest of the codebase (stream route, agentService, supervisor prompt)
 * does NOT need to change — it consumes the same WebIdentity shape.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest } from "next/server";
import prisma from "@/lib/database/prisma";

export interface WebIdentity {
  householdId: string | undefined;
  callerId: string | undefined;
  callerName: string | undefined;
  callerRole: string | undefined;
}

export async function resolveWebIdentity(req: NextRequest, threadId: string): Promise<WebIdentity> {
  // ── TODO: replace this block with getServerSession() when auth is added ──
  const { searchParams } = new URL(req.url);
  const callerId = searchParams.get("callerId") || undefined;
  const callerName = searchParams.get("callerName") || undefined;
  const callerRole = searchParams.get("callerRole") || undefined;
  // ─────────────────────────────────────────────────────────────────────────

  // Household lookup: from thread, or fallback to first household (single-family setup)
  let householdId: string | undefined;

  if (threadId !== "unknown") {
    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      select: { householdId: true },
    });
    householdId = thread?.householdId ?? undefined;
  }

  if (!householdId) {
    const fallback = await prisma.household.findFirst({ select: { id: true } });
    householdId = fallback?.id ?? undefined;
  }

  return { householdId, callerId, callerName, callerRole };
}
