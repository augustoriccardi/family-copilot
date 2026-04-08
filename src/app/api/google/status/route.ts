import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/google/status
 *
 * Returns whether the session user has a Google Calendar connection.
 * Falls back to ?memberId=xxx query param for backward compatibility.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("memberId");

  // Prefer session-based lookup; fall back to memberId param
  const where = session?.user?.id
    ? { userId: session.user.id, provider: "google" }
    : memberId
      ? { memberId, provider: "google" }
      : null;

  if (!where) {
    return NextResponse.json({ connected: false });
  }

  const conn = await prisma.calendarConnection.findFirst({
    where,
    select: { id: true, providerEmail: true },
  });

  return NextResponse.json({
    connected: !!conn,
    email: conn?.providerEmail ?? null,
  });
}
