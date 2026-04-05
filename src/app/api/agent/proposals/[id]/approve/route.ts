import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";
import { ProposalStatus, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/agent/proposals/[id]/approve
 * Marks a proposal as APPROVED.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

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
    data: { status: ProposalStatus.APPROVED, resolvedAt: new Date() },
  });

  return NextResponse.json({
    id: updated.id,
    title: updated.title,
    type: updated.type,
    status: updated.status,
    payload: updated.payload,
  });
}

/**
 * PUT /api/agent/proposals/[id]/approve
 * Edit payload/title then approve in one step.
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
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

  const updateData: Prisma.ActionProposalUpdateInput = {
    status: ProposalStatus.EDITED,
    resolvedAt: new Date(),
  };
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.payload !== undefined) updateData.payload = body.payload as Prisma.InputJsonObject;
  if (body.memberId !== undefined) updateData.member = { connect: { id: body.memberId } };

  const updated = await prisma.actionProposal.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({
    id: updated.id,
    title: updated.title,
    type: updated.type,
    status: updated.status,
    payload: updated.payload,
  });
}
