import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";
import { resolveHouseholdId } from "@/lib/tools/family/index";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/calendar/events?start=ISO&end=ISO&memberId=optional
 * Returns CalendarEvents for the household in FullCalendar EventInput format.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const memberId = searchParams.get("memberId") || undefined;

  if (!startParam || !endParam) {
    return NextResponse.json({ error: "start and end query params are required" }, { status: 400 });
  }

  const start = new Date(startParam);
  const end = new Date(endParam);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  // Resolve household — uses the first household in DB (single-household app)
  const householdId = await resolveHouseholdId();
  if (!householdId) {
    return NextResponse.json({ error: "No household found" }, { status: 404 });
  }

  const where = {
    householdId,
    startsAt: { gte: start },
    endsAt: { lte: end },
    ...(memberId ? { memberId } : {}),
  };

  const events = await prisma.calendarEvent.findMany({
    where,
    include: {
      member: { select: { id: true, name: true, color: true } },
      responsible: { select: { id: true, name: true, color: true } },
      participants: {
        include: {
          member: { select: { id: true, name: true, color: true } },
        },
      },
      memberCalendar: { select: { googleCalendarId: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  // Reverse-lookup: find proposals that originated each event (via calendarEventId)
  const eventIds = events.map((e) => e.id);
  const proposals = await prisma.actionProposal.findMany({
    where: { calendarEventId: { in: eventIds } },
    select: {
      calendarEventId: true,
      source: true,
      notes: true,
      description: true,
      confidence: true,
      sourceFileUrl: true,
    },
  });
  const proposalByEventId = new Map(proposals.map((p) => [p.calendarEventId!, p]));

  // Map to FullCalendar EventInput format
  const fcEvents = events.map((ev) => {
    const originProposal = proposalByEventId.get(ev.id);
    return {
      id: ev.id,
      title: ev.title,
      start: ev.startsAt.toISOString(),
      end: ev.endsAt.toISOString(),
      allDay: ev.allDay,
      // Color based on member — fallback to eventType color
      backgroundColor: ev.member?.color ?? eventTypeColor(ev.eventType),
      borderColor: ev.member?.color ?? eventTypeColor(ev.eventType),
      textColor: "#ffffff",
      extendedProps: {
        description: ev.description,
        location: ev.location,
        eventType: ev.eventType,
        status: ev.status,
        member: ev.member,
        responsible: ev.responsible,
        participants: ev.participants.map((p) => ({
          id: p.memberId,
          name: p.member.name,
          color: p.member.color,
          role: p.role,
          rsvp: p.rsvpStatus,
        })),
        externalEventId: ev.externalEventId,
        googleCalendarId: ev.memberCalendar?.googleCalendarId ?? null,
        notes: ev.notes,
        sourceType: originProposal?.source ?? null,
        sourceNotes: originProposal?.description ?? originProposal?.notes ?? null,
        sourceFileUrl: originProposal?.sourceFileUrl ?? null,
      },
    };
  });

  return NextResponse.json({ events: fcEvents });
}

function eventTypeColor(eventType: string): string {
  const colors: Record<string, string> = {
    FAMILY: "#6366f1",
    PERSONAL: "#8b5cf6",
    MEDICAL: "#ef4444",
    SCHOOL: "#3b82f6",
    ACTIVITY: "#f59e0b",
    WORK: "#6b7280",
    OTHER: "#10b981",
  };
  return colors[eventType] ?? "#6366f1";
}
