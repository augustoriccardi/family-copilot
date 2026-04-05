import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";
import { ProposalStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/agent/proposals/[id]/reject
 * Body: { reason?: string }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const proposal = await prisma.actionProposal.findUnique({ where: { id } });
  if (!proposal) {
    return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });
  }
  if (proposal.status !== ProposalStatus.PENDING) {
    return NextResponse.json(
      { error: `La propuesta ya fue ${proposal.status.toLowerCase()}` },
      { status: 409 },
    );
  }

  const updated = await prisma.actionProposal.update({
    where: { id },
    data: {
      status: ProposalStatus.REJECTED,
      resolvedAt: new Date(),
      ...(body.reason ? { notes: body.reason } : {}),
    },
  });

  return NextResponse.json({
    id: updated.id,
    title: updated.title,
    status: updated.status,
  });
}
