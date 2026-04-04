import prisma from "@/lib/database/prisma";
import type { AgentContext } from "../family/index";

export async function createReminderTool(
  args: {
    title: string;
    description?: string;
    dueAt: string;
    memberId?: string;
    recurrenceRule?: string;
  },
  ctx: AgentContext,
) {
  const reminder = await prisma.reminder.create({
    data: {
      householdId: ctx.householdId,
      memberId: args.memberId,
      title: args.title,
      description: args.description,
      dueAt: new Date(args.dueAt),
      recurrenceRule: args.recurrenceRule,
    },
  });

  return {
    reminderId: reminder.id,
    title: reminder.title,
    dueAt: reminder.dueAt.toISOString(),
  };
}

export async function listRemindersTool(
  args: {
    startDate?: string;
    endDate?: string;
    memberId?: string;
  },
  ctx: AgentContext,
) {
  const where: Record<string, unknown> = {
    householdId: ctx.householdId,
    status: "PENDING",
  };

  if (args.startDate || args.endDate) {
    where.dueAt = {};
    if (args.startDate) (where.dueAt as Record<string, unknown>).gte = new Date(args.startDate);
    if (args.endDate) (where.dueAt as Record<string, unknown>).lte = new Date(args.endDate);
  }

  if (args.memberId) where.memberId = args.memberId;

  const reminders = await prisma.reminder.findMany({
    where,
    include: { member: true },
    orderBy: { dueAt: "asc" },
  });

  return reminders.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    member: r.member?.name ?? "Familia",
    dueAt: r.dueAt.toISOString(),
    status: r.status,
  }));
}

export async function completeReminderTool(args: { reminderId: string }, ctx: AgentContext) {
  const result = await prisma.reminder.updateMany({
    where: { id: args.reminderId, householdId: ctx.householdId },
    data: { status: "DONE" },
  });
  return { updated: result.count > 0 };
}

export async function dismissReminderTool(args: { reminderId: string }, ctx: AgentContext) {
  const result = await prisma.reminder.updateMany({
    where: { id: args.reminderId, householdId: ctx.householdId },
    data: { status: "DISMISSED" },
  });
  return { dismissed: result.count > 0 };
}

export async function deleteReminderTool(args: { reminderId: string }, ctx: AgentContext) {
  const deleted = await prisma.reminder.deleteMany({
    where: { id: args.reminderId, householdId: ctx.householdId },
  });
  return { deleted: deleted.count > 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE REMINDER FROM NOTIFICATION REQUEST (calendar → reminder handoff)
// ─────────────────────────────────────────────────────────────────────────────

export async function createReminderFromNotificationTool(
  args: {
    title: string;
    message?: string;
    dueAt: string;
    memberId?: string;
    calendarEventId?: string;
    recurrenceRule?: string;
    minutesBefore?: number;
  },
  ctx: AgentContext,
) {
  if (args.memberId) {
    const member = await prisma.familyMember.findFirst({
      where: { id: args.memberId, householdId: ctx.householdId },
      select: { id: true },
    });
    if (!member) {
      return { error: `Miembro con ID "${args.memberId}" no encontrado en este hogar.` };
    }
  }

  if (args.calendarEventId) {
    const event = await prisma.calendarEvent.findFirst({
      where: { id: args.calendarEventId, householdId: ctx.householdId },
      select: { id: true },
    });
    if (!event) {
      return {
        error: `Evento con ID "${args.calendarEventId}" no encontrado. Se creará el recordatorio sin vinculación al evento.`,
      };
    }
  }

  const reminder = await prisma.reminder.create({
    data: {
      householdId: ctx.householdId,
      memberId: args.memberId ?? null,
      calendarEventId: args.calendarEventId ?? null,
      title: args.title,
      description: args.message,
      dueAt: new Date(args.dueAt),
      recurrenceRule: args.recurrenceRule ?? null,
      minutesBefore: args.minutesBefore ?? null,
    },
  });

  return {
    reminderId: reminder.id,
    title: reminder.title,
    dueAt: reminder.dueAt.toISOString(),
    linkedToEvent: !!args.calendarEventId,
  };
}
