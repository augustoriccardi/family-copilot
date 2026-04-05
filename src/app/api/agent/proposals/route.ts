import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";
import { ProposalStatus, ProposalType } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Resolves householdId from a threadId query param, falling back to the first household.
 */
async function resolveHouseholdId(threadId: string | null): Promise<string | null> {
  if (threadId) {
    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      select: { householdId: true },
    });
    if (thread?.householdId) return thread.householdId;
  }
  const fallback = await prisma.household.findFirst({ select: { id: true } });
  return fallback?.id ?? null;
}

/**
 * GET /api/agent/proposals?threadId=<id>&status=PENDING&type=EVENT
 * Returns proposals for the household, optionally filtered by status/type.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");
  const statusFilter = searchParams.get("status") as ProposalStatus | null;
  const typeFilter = searchParams.get("type") as ProposalType | null;

  const householdId = await resolveHouseholdId(threadId);
  if (!householdId) {
    return NextResponse.json({ proposals: [] });
  }

  const proposals = await prisma.actionProposal.findMany({
    where: {
      householdId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(typeFilter ? { type: typeFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      member: { select: { id: true, name: true, color: true } },
    },
  });

  return NextResponse.json({
    proposals: proposals.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      type: p.type,
      status: p.status,
      source: p.source,
      confidence: p.confidence,
      notes: p.notes,
      payload: p.payload,
      member: p.member,
      createdAt: p.createdAt.toISOString(),
      resolvedAt: p.resolvedAt?.toISOString() ?? null,
    })),
  });
}
