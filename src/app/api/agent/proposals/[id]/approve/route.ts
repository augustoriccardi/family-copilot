import { NextRequest, NextResponse } from "next/server";
import { approveProposalTool, editAndApproveProposalTool } from "@/lib/tools/proposals/index";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/database/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/agent/proposals/[id]/approve
 * Marks a proposal as APPROVED and creates the real entity.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const proposal = await prisma.actionProposal.findUnique({ where: { id } });
  if (!proposal) {
    return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });
  }

  const ctx = { householdId: proposal.householdId };
  const result = await approveProposalTool({ proposalId: id }, ctx);

  if ("error" in result) {
    const status = result.error === "Propuesta no encontrada" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  if ("entityError" in result && result.entityError) {
    // Entity creation failed — roll back the proposal to PENDING so the user can fix and retry
    await prisma.actionProposal.update({
      where: { id },
      data: { status: "PENDING", resolvedAt: null },
    });
    return NextResponse.json({ error: result.entityError }, { status: 422 });
  }

  return NextResponse.json(result);
}

/**
 * PUT /api/agent/proposals/[id]/approve
 * Edit payload/title then approve in one step, then creates the real entity.
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const proposal = await prisma.actionProposal.findUnique({ where: { id } });
  if (!proposal) {
    return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });
  }

  const ctx = { householdId: proposal.householdId };
  const result = await editAndApproveProposalTool(
    {
      proposalId: id,
      title: body.title,
      description: body.description,
      payload: body.payload as Prisma.InputJsonObject | undefined,
      memberId: body.memberId,
    },
    ctx,
  );

  if ("error" in result) {
    const status = result.error === "Propuesta no encontrada" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result);
}
