import prisma from "@/lib/database/prisma";
import { ProposalType, ProposalStatus, Prisma } from "@prisma/client";
import type { AgentContext } from "../family/index";
import { createCalendarEventTool } from "../calendar/index";
import { createReminderTool } from "../reminders/index";
import { addItemsToShoppingListTool } from "../shopping/index";

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
    sourceFileUrl?: string;
  },
  ctx: AgentContext,
) {
  console.log(
    "[createProposalTool] called with householdId:",
    ctx.householdId,
    "title:",
    args.title,
  );
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
      sourceFileUrl: args.sourceFileUrl ?? null,
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

export async function getProposalTool(args: { proposalId: string }, ctx: AgentContext) {
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

// ── Entity dispatch ───────────────────────────────────────────────────────────

async function dispatchEntityCreation(
  type: ProposalType,
  payload: Prisma.JsonValue,
  ctx: AgentContext,
  proposalMeta?: { title?: string; description?: string | null; memberId?: string | null },
): Promise<{ entity?: unknown; entityError?: string }> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const fallbackTitle = proposalMeta?.title;
  const fallbackDesc = proposalMeta?.description ?? undefined;
  // memberId from payload takes precedence; fall back to the top-level proposal memberId
  const resolvedMemberId: string | undefined =
    (p.memberId ? String(p.memberId) : undefined) ?? proposalMeta?.memberId ?? undefined;

  if (type === ProposalType.EVENT) {
    const startDateTime = String(p.startDateTime ?? p.startAt ?? "");
    const endDateTimeRaw = String(p.endDateTime ?? p.endAt ?? "");
    const endDateTime =
      endDateTimeRaw && !isNaN(new Date(endDateTimeRaw).getTime()) ? endDateTimeRaw : undefined;

    // Guard: don't pass invalid dates to Prisma
    if (!startDateTime || isNaN(new Date(startDateTime).getTime())) {
      return {
        entityError:
          "La propuesta no tiene fecha de inicio definida. Editá la propuesta y agregá la fecha antes de aprobarla.",
      };
    }

    const result = await createCalendarEventTool(
      {
        title: String(p.title ?? fallbackTitle ?? "Evento"),
        description: p.description ? String(p.description) : fallbackDesc,
        startDateTime,
        endDateTime,
        allDay: p.allDay ? Boolean(p.allDay) : undefined,
        location: p.location ? String(p.location) : undefined,
        eventType: p.eventType as
          | "FAMILY"
          | "PERSONAL"
          | "MEDICAL"
          | "SCHOOL"
          | "ACTIVITY"
          | "WORK"
          | "OTHER"
          | undefined,
        memberId: resolvedMemberId,
        participantIds: Array.isArray(p.participantIds)
          ? (p.participantIds as string[])
          : undefined,
        responsibleMemberId: p.responsibleMemberId ? String(p.responsibleMemberId) : undefined,
        notes: p.notes ? String(p.notes) : undefined,
      },
      ctx,
    );
    if ("error" in result) return { entityError: result.error as string };
    return { entity: result };
  }

  if (type === ProposalType.REMINDER) {
    const result = await createReminderTool(
      {
        title: String(p.title ?? fallbackTitle ?? "Recordatorio"),
        description: p.description ? String(p.description) : fallbackDesc,
        dueAt: String(p.dueAt ?? ""),
        memberId: p.memberId ? String(p.memberId) : undefined,
        recurrenceRule: p.recurrenceRule ? String(p.recurrenceRule) : undefined,
      },
      ctx,
    );
    return { entity: result };
  }

  if (type === ProposalType.SHOPPING_ITEM) {
    // Find or create the active shopping list
    let activeList = await prisma.shoppingList.findFirst({
      where: { householdId: ctx.householdId, status: { in: ["DRAFT", "ACTIVE"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!activeList) {
      activeList = await prisma.shoppingList.create({
        data: { householdId: ctx.householdId, name: "Lista de compras", status: "ACTIVE" },
      });
    }
    const result = await addItemsToShoppingListTool(
      {
        listId: activeList.id,
        items: [
          {
            itemName: String(p.itemName ?? p.name ?? fallbackTitle ?? "Item"),
            quantity: p.quantity ? Number(p.quantity) : undefined,
            unit: p.unit ? String(p.unit) : undefined,
            category: p.category ? String(p.category) : undefined,
            notes: p.notes ? String(p.notes) : undefined,
          },
        ],
      },
      ctx,
    );
    return { entity: result };
  }

  // DOCUMENT / OTHER — no downstream entity
  return {};
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function approveProposalTool(args: { proposalId: string }, ctx: AgentContext) {
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

  const { entity, entityError } = await dispatchEntityCreation(updated.type, updated.payload, ctx, {
    title: updated.title,
    description: updated.description,
    memberId: updated.memberId,
  });

  // Link the proposal back to the created CalendarEvent for traceability
  const createdEventId = (entity as { eventId?: string } | undefined)?.eventId;
  if (createdEventId) {
    await prisma.actionProposal.update({
      where: { id: args.proposalId },
      data: { calendarEventId: createdEventId },
    });
  }

  return {
    proposalId: updated.id,
    title: updated.title,
    type: updated.type,
    status: updated.status,
    ...(entity ? { created: entity } : {}),
    ...(entityError ? { entityError } : {}),
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

  const { entity, entityError } = await dispatchEntityCreation(updated.type, updated.payload, ctx, {
    title: updated.title,
    description: updated.description,
    memberId: updated.memberId,
  });

  // Link the proposal back to the created CalendarEvent for traceability
  const createdEventIdEdit = (entity as { eventId?: string } | undefined)?.eventId;
  if (createdEventIdEdit) {
    await prisma.actionProposal.update({
      where: { id: args.proposalId },
      data: { calendarEventId: createdEventIdEdit },
    });
  }

  return {
    proposalId: updated.id,
    title: updated.title,
    type: updated.type,
    status: updated.status,
    ...(entity ? { created: entity } : {}),
    ...(entityError ? { entityError } : {}),
  };
}
