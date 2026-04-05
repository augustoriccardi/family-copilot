import prisma from "@/lib/database/prisma";
import { ProposalType, ProposalStatus, Prisma } from "@prisma/client";
import type { AgentContext } from "../family/index";

export type { ProposalType, ProposalStatus };

// ── Create ────────────────────────────────────────────────────────────────────

export async function createProposalTool(
  args: {
    type: ProposalType;
    title: string;
    description?: string;
    payload: Prisma.InputJsonObject;
    source: string;
    confidence?: number;
    memberId?: string;
    notes?: string;
  },
  ctx: AgentContext,
) {
  const proposal = await prisma.actionProposal.create({
    data: {
      householdId: ctx.householdId,
      memberId: args.memberId ?? null,
      type: args.type,
      title: args.title,
      description: args.description ?? null,
      payload: args.payload,
      source: args.source,
      confidence: args.confidence ?? 0.8,
      notes: args.notes ?? null,
    },
  });

  return {
    proposalId: proposal.id,
    title: proposal.title,
    type: proposal.type,
    status: proposal.status,
    source: proposal.source,
    confidence: proposal.confidence,
  };
}

// ── List pending ──────────────────────────────────────────────────────────────

export async function listPendingProposalsTool(
  args: {
    memberId?: string;
    type?: ProposalType;
  },
  ctx: AgentContext,
) {
  const proposals = await prisma.actionProposal.findMany({
    where: {
      householdId: ctx.householdId,
      status: ProposalStatus.PENDING,
      ...(args.memberId ? { memberId: args.memberId } : {}),
      ...(args.type ? { type: args.type } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      member: { select: { id: true, name: true } },
    },
  });

  return proposals.map((p) => ({
    proposalId: p.id,
    title: p.title,
    type: p.type,
    source: p.source,
    confidence: p.confidence,
    member: p.member ? { id: p.member.id, name: p.member.name } : null,
    createdAt: p.createdAt.toISOString(),
    notes: p.notes,
    payload: p.payload,
  }));
}

// ── Get one ───────────────────────────────────────────────────────────────────

export async function getProposalTool(
  args: { proposalId: string },
  ctx: AgentContext,
) {
  const proposal = await prisma.actionProposal.findFirst({
    where: { id: args.proposalId, householdId: ctx.householdId },
    include: { member: { select: { id: true, name: true } } },
  });

  if (!proposal) return { error: "Propuesta no encontrada" };

  return {
    proposalId: proposal.id,
    title: proposal.title,
    description: proposal.description,
    type: proposal.type,
    status: proposal.status,
    source: proposal.source,
    confidence: proposal.confidence,
    member: proposal.member ? { id: proposal.member.id, name: proposal.member.name } : null,
    notes: proposal.notes,
    payload: proposal.payload,
    createdAt: proposal.createdAt.toISOString(),
  };
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function approveProposalTool(
  args: { proposalId: string },
  ctx: AgentContext,
) {
  const proposal = await prisma.actionProposal.findFirst({
    where: { id: args.proposalId, householdId: ctx.householdId },
  });

  if (!proposal) return { error: "Propuesta no encontrada" };
  if (proposal.status !== ProposalStatus.PENDING) {
    return { error: `La propuesta ya fue ${proposal.status.toLowerCase()}` };
  }

  const updated = await prisma.actionProposal.update({
    where: { id: args.proposalId },
    data: {
      status: ProposalStatus.APPROVED,
      resolvedAt: new Date(),
    },
  });

  return {
    proposalId: updated.id,
    title: updated.title,
    type: updated.type,
    status: updated.status,
    payload: updated.payload,
  };
}

// ── Reject ────────────────────────────────────────────────────────────────────

export async function rejectProposalTool(
  args: { proposalId: string; reason?: string },
  ctx: AgentContext,
) {
  const proposal = await prisma.actionProposal.findFirst({
    where: { id: args.proposalId, householdId: ctx.householdId },
  });

  if (!proposal) return { error: "Propuesta no encontrada" };
  if (proposal.status !== ProposalStatus.PENDING) {
    return { error: `La propuesta ya fue ${proposal.status.toLowerCase()}` };
  }

  const updated = await prisma.actionProposal.update({
    where: { id: args.proposalId },
    data: {
      status: ProposalStatus.REJECTED,
      resolvedAt: new Date(),
      notes: args.reason ?? proposal.notes,
    },
  });

  return {
    proposalId: updated.id,
    title: updated.title,
    status: updated.status,
  };
}

// ── Edit and approve ──────────────────────────────────────────────────────────

export async function editAndApproveProposalTool(
  args: {
    proposalId: string;
    title?: string;
    description?: string;
    payload?: Prisma.InputJsonObject;
    memberId?: string;
  },
  ctx: AgentContext,
) {
  const proposal = await prisma.actionProposal.findFirst({
    where: { id: args.proposalId, householdId: ctx.householdId },
  });

  if (!proposal) return { error: "Propuesta no encontrada" };
  if (proposal.status !== ProposalStatus.PENDING) {
    return { error: `La propuesta ya fue ${proposal.status.toLowerCase()}` };
  }

  const updateData: Prisma.ActionProposalUpdateInput = {
    status: ProposalStatus.EDITED,
    resolvedAt: new Date(),
  };
  if (args.title !== undefined) updateData.title = args.title;
  if (args.description !== undefined) updateData.description = args.description;
  if (args.payload !== undefined) updateData.payload = args.payload;
  if (args.memberId !== undefined) updateData.member = { connect: { id: args.memberId } };

  const updated = await prisma.actionProposal.update({
    where: { id: args.proposalId },
    data: updateData,
  });

  return {
    proposalId: updated.id,
    title: updated.title,
    type: updated.type,
    status: updated.status,
    payload: updated.payload,
  };
}
