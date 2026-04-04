import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/google/status?memberId=xxx
 *
 * Returns whether the given family member has a Google account connected.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("memberId");

  if (!memberId) {
    return NextResponse.json({ connected: false });
  }

  const conn = await prisma.calendarConnection.findFirst({
    where: { memberId, provider: "google" },
    select: { id: true, providerEmail: true },
  });

  return NextResponse.json({
    connected: !!conn,
    email: conn?.providerEmail ?? null,
  });
}
