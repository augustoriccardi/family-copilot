import prisma from "@/lib/database/prisma";
import type { AgentContext } from "../family/index";

export async function createCalendarEventTool(
  args: {
    title: string;
    description?: string;
    startDateTime: string;
    endDateTime: string;
    location?: string;
    memberId?: string;
    notes?: string;
  },
  ctx: AgentContext,
) {
  const event = await prisma.calendarEvent.create({
    data: {
      householdId: ctx.householdId,
      memberId: args.memberId,
      title: args.title,
      description: args.description,
      startsAt: new Date(args.startDateTime),
      endsAt: new Date(args.endDateTime),
      location: args.location,
      notes: args.notes,
    },
  });

  return {
    eventId: event.id,
    title: event.title,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    location: event.location,
  };
}

export async function listCalendarEventsTool(
  args: {
    startDate: string;
    endDate: string;
    memberId?: string;
  },
  ctx: AgentContext,
) {
  const where: Record<string, unknown> = {
    householdId: ctx.householdId,
    startsAt: { gte: new Date(args.startDate) },
    endsAt: { lte: new Date(args.endDate) },
  };

  if (args.memberId) where.memberId = args.memberId;

  const events = await prisma.calendarEvent.findMany({
    where,
    include: { member: true },
    orderBy: { startsAt: "asc" },
  });

  return events.map((e) => ({
    id: e.id,
    title: e.title,
    member: e.member?.name ?? "Familia",
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    location: e.location,
    notes: e.notes,
  }));
}

export async function updateCalendarEventTool(
  args: {
    eventId: string;
    title?: string;
    startDateTime?: string;
    endDateTime?: string;
    location?: string;
    notes?: string;
  },
  ctx: AgentContext,
) {
  const event = await prisma.calendarEvent.findFirst({
    where: { id: args.eventId, householdId: ctx.householdId },
  });
  if (!event) throw new Error("Evento no encontrado");

  const updated = await prisma.calendarEvent.update({
    where: { id: args.eventId },
    data: {
      ...(args.title && { title: args.title }),
      ...(args.startDateTime && { startsAt: new Date(args.startDateTime) }),
      ...(args.endDateTime && { endsAt: new Date(args.endDateTime) }),
      ...(args.location !== undefined && { location: args.location }),
      ...(args.notes !== undefined && { notes: args.notes }),
    },
  });

  return { eventId: updated.id, title: updated.title };
}

export async function deleteCalendarEventTool(args: { eventId: string }, ctx: AgentContext) {
  const event = await prisma.calendarEvent.findFirst({
    where: { id: args.eventId, householdId: ctx.householdId },
  });
  if (!event) throw new Error("Evento no encontrado");

  await prisma.calendarEvent.delete({ where: { id: args.eventId } });

  return { deleted: true, title: event.title };
}

export async function findFreeSlotsTool(
  args: {
    startDate: string;
    endDate: string;
    durationMinutes: number;
    memberId?: string;
  },
  ctx: AgentContext,
) {
  const start = new Date(args.startDate);
  const end = new Date(args.endDate);

  const where: Record<string, unknown> = {
    householdId: ctx.householdId,
    startsAt: { gte: start },
    endsAt: { lte: end },
  };
  if (args.memberId) where.memberId = args.memberId;

  const busy = await prisma.calendarEvent.findMany({
    where,
    orderBy: { startsAt: "asc" },
    select: { startsAt: true, endsAt: true },
  });

  // Simple slot finder: iterate day by day in business hours (8-20)
  const slots: Array<{ start: string; end: string }> = [];
  const duration = args.durationMinutes * 60 * 1000;
  let cursor = new Date(start);
  cursor.setHours(8, 0, 0, 0);

  while (cursor < end && slots.length < 5) {
    const slotEnd = new Date(cursor.getTime() + duration);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(20, 0, 0, 0);

    if (slotEnd <= dayEnd) {
      const conflicts = busy.some((b) => cursor < b.endsAt && slotEnd > b.startsAt);
      if (!conflicts) {
        slots.push({
          start: cursor.toISOString(),
          end: slotEnd.toISOString(),
        });
        cursor = slotEnd;
        continue;
      }
    }

    // Move to next day
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(8, 0, 0, 0);
  }

  return { slots };
}
