import prisma from "@/lib/database/prisma";
import type { AgentContext } from "../family/index";
import { sendWhatsAppMessage } from "@/lib/whatsapp/whatsapp-service";
import { google } from "googleapis";

const DEFAULT_TZ = "America/Montevideo";

/** Fetch the household's configured timezone, falling back to DEFAULT_TZ. */
async function getHouseholdTZ(householdId: string): Promise<string> {
  const h = await prisma.household.findUnique({
    where: { id: householdId },
    select: { timezone: true },
  });
  return h?.timezone || DEFAULT_TZ;
}

/** Format a Date as a local ISO-8601 string in the household's timezone (no trailing Z).
 *  e.g. "2026-04-04T17:00:00" — allows the LLM to reason about times without UTC confusion. */
function toLocalISO(date: Date, tz: string): string {
  return date.toLocaleString("sv-SE", { timeZone: tz, hour12: false }).replace(" ", "T");
}

/**
 * Syncs a calendar event to Google Calendar using server-side OAuth credentials.
 * Called automatically by createCalendarEventTool — the LLM does NOT need to call any MCP tool.
 * Returns the Google Calendar event ID on success, null on failure (non-fatal).
 */
async function syncToGoogleCalendar(params: {
  title: string;
  description?: string | null;
  startDateTime: string; // local ISO, e.g. "2026-04-04T17:00:00"
  endDateTime: string;
  location?: string | null;
  calendarId: string;
  timeZone: string;
  eventDbId: string;
  /** Per-member refresh token (from CalendarConnection). Falls back to global GOOGLE_REFRESH_TOKEN. */
  refreshToken?: string | null;
}): Promise<{ eventId: string; htmlLink: string | null } | null> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  const effectiveRefreshToken = params.refreshToken ?? GOOGLE_REFRESH_TOKEN;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !effectiveRefreshToken) return null;

  try {
    const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: effectiveRefreshToken });
    const cal = google.calendar({ version: "v3", auth });

    const res = await cal.events.insert({
      calendarId: params.calendarId,
      requestBody: {
        summary: params.title,
        description: params.description ?? undefined,
        location: params.location ?? undefined,
        start: { dateTime: params.startDateTime, timeZone: params.timeZone },
        end: { dateTime: params.endDateTime, timeZone: params.timeZone },
      },
    });

    const gcalEventId = res.data.id ?? null;
    if (gcalEventId) {
      // Persist the external event ID so update/delete can sync too
      await prisma.calendarEvent.update({
        where: { id: params.eventDbId },
        data: { externalEventId: gcalEventId },
      });
    }
    return gcalEventId ? { eventId: gcalEventId, htmlLink: res.data.htmlLink ?? null } : null;
  } catch (err) {
    console.error("[syncToGoogleCalendar] Error:", err);
    return null;
  }
}

// -------------------------------------------------------------------------
// CREAR EVENTO
// -------------------------------------------------------------------------

export async function createCalendarEventTool(
  args: {
    title: string;
    description?: string;
    startDateTime: string;
    endDateTime?: string;
    allDay?: boolean;
    location?: string;
    eventType?: "FAMILY" | "PERSONAL" | "MEDICAL" | "SCHOOL" | "ACTIVITY" | "WORK" | "OTHER";
    memberId?: string;
    responsibleMemberId?: string;
    createdByMemberId?: string;
    participantIds?: string[];
    participantRoles?: Array<{
      memberId: string;
      role: "ORGANIZER" | "PARTICIPANT" | "RESPONSIBLE" | "OPTIONAL";
    }>;
    memberCalendarId?: string | null;
    notes?: string;
  },
  ctx: AgentContext,
) {
  const roleMap = new Map<string, "ORGANIZER" | "PARTICIPANT" | "RESPONSIBLE" | "OPTIONAL">();
  for (const pr of args.participantRoles ?? []) roleMap.set(pr.memberId, pr.role);

  // Validate memberId / responsibleMemberId exist in DB (LLM may hallucinate IDs).
  // Falls back to callerId from context if provided ID doesn't exist.

  // First validate callerId itself against the DB
  let validCallerId: string | undefined;
  if (ctx.callerId) {
    const callerExists = await prisma.familyMember.findUnique({
      where: { id: ctx.callerId },
      select: { id: true },
    });
    if (callerExists) validCallerId = ctx.callerId;
  }
  // If callerId is also invalid, try to find any household member as last resort
  if (!validCallerId && ctx.householdId) {
    const anyMember = await prisma.familyMember.findFirst({
      where: { householdId: ctx.householdId },
      select: { id: true },
    });
    validCallerId = anyMember?.id;
  }

  async function resolveValidMemberId(id: string | undefined): Promise<string | undefined> {
    if (!id) return undefined;
    const exists = await prisma.familyMember.findUnique({ where: { id }, select: { id: true } });
    if (exists) return id;
    return validCallerId;
  }

  const memberId = (await resolveValidMemberId(args.memberId)) ?? validCallerId;
  const responsibleMemberId = await resolveValidMemberId(args.responsibleMemberId);
  const createdByMemberId = await resolveValidMemberId(args.createdByMemberId);

  if (!memberId) {
    return {
      error:
        "No se pudo determinar el integrante para el evento. Especificá el nombre del integrante.",
    };
  }

  // Validate participantIds — silently drop any that don't exist
  const validParticipantIds: string[] = [];
  for (const pid of args.participantIds ?? []) {
    const exists = await prisma.familyMember.findUnique({
      where: { id: pid },
      select: { id: true },
    });
    if (exists) validParticipantIds.push(pid);
  }

  const participantSet = new Set<string>(validParticipantIds);
  if (memberId) participantSet.add(memberId);
  if (responsibleMemberId) participantSet.add(responsibleMemberId);

  // Resolve the MemberCalendar to use for Google Calendar sync.
  // Priority: explicit memberCalendarId from LLM → auto-resolve from responsible/caller/member
  // This auto-fallback makes sync resilient when the LLM skips calling get_member_calendars.
  let resolvedCalendarId: string | null = null;
  if (args.memberCalendarId) {
    // Validate the provided ID exists (LLM may hallucinate IDs)
    const cal = await prisma.memberCalendar.findUnique({
      where: { id: args.memberCalendarId },
      select: { id: true },
    });
    resolvedCalendarId = cal?.id ?? null;
  }
  if (!resolvedCalendarId) {
    // Auto-resolve: try responsible → caller → primary beneficiary, in that order.
    // For family events, prefer FAMILY_SHARED; otherwise use PERSONAL isPrimary=true.
    const candidateIds = [responsibleMemberId, ctx.callerId, memberId].filter(
      (id): id is string => !!id,
    );

    for (const candidateId of candidateIds) {
      const calendars = await prisma.memberCalendar.findMany({
        where: { householdMemberId: candidateId },
        orderBy: [{ isPrimary: "desc" }],
        select: { id: true, type: true, isPrimary: true },
      });
      if (calendars.length === 0) continue;
      const isFamily = (args.eventType ?? "FAMILY") === "FAMILY";
      const preferred =
        (isFamily && calendars.find((c) => c.type === "FAMILY_SHARED")) ||
        calendars.find((c) => c.isPrimary) ||
        calendars[0];
      resolvedCalendarId = preferred?.id ?? null;
      if (resolvedCalendarId) break;
    }
  }

  // Last resort: use any FAMILY_SHARED calendar in the household (shared by all members).
  // This ensures events always sync to Google Calendar even when the beneficiary has no
  // personal calendar configured (e.g. children whose events go to a parent's shared calendar).
  if (!resolvedCalendarId) {
    const sharedCal = await prisma.memberCalendar.findFirst({
      where: {
        type: "FAMILY_SHARED",
        member: { householdId: ctx.householdId },
      },
      select: { id: true },
    });
    resolvedCalendarId = sharedCal?.id ?? null;
  }

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.calendarEvent.create({
      data: {
        householdId: ctx.householdId,
        memberId: memberId,
        responsibleMemberId: responsibleMemberId,
        createdByMemberId: createdByMemberId,
        memberCalendarId: resolvedCalendarId,
        title: args.title,
        description: args.description,
        eventType: args.eventType ?? "FAMILY",
        startsAt: new Date(args.startDateTime),
        endsAt: args.endDateTime
          ? new Date(args.endDateTime)
          : new Date(new Date(args.startDateTime).getTime() + 60 * 60 * 1000),
        allDay: args.allDay ?? false,
        location: args.location,
        notes: args.notes,
      },
      include: {
        member: true,
        responsible: true,
        memberCalendar: { include: { connection: true } },
      },
    });

    if (participantSet.size > 0) {
      await tx.calendarEventParticipant.createMany({
        data: Array.from(participantSet).map((memberId) => ({
          eventId: created.id,
          memberId,
          role:
            roleMap.get(memberId) ??
            (memberId === responsibleMemberId ? "RESPONSIBLE" : "PARTICIPANT"),
        })),
        skipDuplicates: true,
      });
    }

    return created;
  });

  const tz = await getHouseholdTZ(ctx.householdId);

  // Fetch participants for rich Google Calendar description
  const participants = await prisma.calendarEventParticipant.findMany({
    where: { eventId: event.id },
    include: { member: { select: { name: true } } },
  });

  // Auto-sync to Google Calendar if the event has a configured external calendar.
  // This is done server-side so the LLM doesn't need to call a separate MCP step.
  let googleCalendarEventId: string | null = null;
  let googleCalendarHtmlLink: string | null = null;
  let syncedToGoogle = false;
  if (event.memberCalendar?.googleCalendarId) {
    // Build a rich description from all available metadata
    const descParts: string[] = [];
    if (args.description) descParts.push(args.description);
    if (event.member) descParts.push(`👤 Para: ${event.member.name}`);
    if (event.responsible && event.responsible.id !== event.member?.id)
      descParts.push(`🙋 Responsable: ${event.responsible.name}`);
    if (participants.length > 0) {
      const names = participants.map((p) => p.member.name).join(", ");
      descParts.push(`👥 Participantes: ${names}`);
    }
    if (event.eventType !== "FAMILY") descParts.push(`📌 Tipo: ${event.eventType}`);
    if (args.notes) descParts.push(`📝 Notas: ${args.notes}`);
    descParts.push(`🆔 ID app: ${event.id}`);
    const richDescription = descParts.join("\n");

    const gcalResult = await syncToGoogleCalendar({
      title: event.title,
      description: richDescription,
      startDateTime: toLocalISO(event.startsAt, tz),
      endDateTime: toLocalISO(event.endsAt, tz),
      location: event.location,
      calendarId: event.memberCalendar.googleCalendarId,
      timeZone: tz,
      eventDbId: event.id,
      refreshToken: event.memberCalendar.connection?.refreshToken,
    });
    googleCalendarEventId = gcalResult?.eventId ?? null;
    googleCalendarHtmlLink = gcalResult?.htmlLink ?? null;
    syncedToGoogle = !!googleCalendarEventId;
  }

  void notifyEventCreated(event, ctx.householdId, tz);

  return {
    eventId: event.id,
    title: event.title,
    eventType: event.eventType,
    member: event.member?.name ?? "Familia",
    responsible: event.responsible?.name ?? null,
    startsAt: toLocalISO(event.startsAt, tz),
    endsAt: toLocalISO(event.endsAt, tz),
    allDay: event.allDay,
    location: event.location,
    participantCount: participantSet.size,
    googleCalendarSync: syncedToGoogle
      ? {
          synced: true,
          calendarId: event.memberCalendar!.googleCalendarId,
          eventId: googleCalendarEventId,
          htmlLink: googleCalendarHtmlLink,
        }
      : event.memberCalendar?.googleCalendarId
        ? {
            synced: false,
            error: "Google Calendar sync failed — credentials may be missing or invalid",
          }
        : { synced: false, reason: "No external calendar configured for this member" },
  };
}

async function notifyEventCreated(
  event: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    location: string | null;
    member: { name: string } | null;
    responsible: { name: string } | null;
  },
  householdId: string,
  tz: string,
): Promise<void> {
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) return;
  try {
    const members = await prisma.familyMember.findMany({
      where: { householdId, whatsappPhone: { not: null } },
      select: { whatsappPhone: true, name: true },
    });
    if (members.length === 0) return;

    const dateStr = event.startsAt.toLocaleDateString("es-UY", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: tz,
    });
    const timeStr = event.startsAt.toLocaleTimeString("es-UY", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });
    const lines: string[] = [
      "\uD83D\uDCC5 *Nuevo evento agendado*",
      `*${event.title}*`,
      `\uD83D\uDDD3 ${dateStr} a las ${timeStr}`,
    ];
    if (event.member) lines.push(`\uD83D\uDC64 Para: ${event.member.name}`);
    if (event.responsible) lines.push(`\uD83D\uDE4B Responsable: ${event.responsible.name}`);
    if (event.location) lines.push(`\uD83D\uDCCD ${event.location}`);
    const message = lines.join("\n");

    await Promise.allSettled(
      members
        .filter((m) => m.whatsappPhone)
        .map((m) => sendWhatsAppMessage(m.whatsappPhone!, message)),
    );
  } catch (err) {
    console.error("[notifyEventCreated] Error:", err);
  }
}

// -------------------------------------------------------------------------
// LISTAR EVENTOS
// -------------------------------------------------------------------------

export async function listCalendarEventsTool(
  args: {
    startDate: string;
    endDate: string;
    memberId?: string;
    includeAsParticipant?: boolean;
  },
  ctx: AgentContext,
) {
  const base = {
    householdId: ctx.householdId,
    startsAt: { gte: new Date(args.startDate) },
    endsAt: { lte: new Date(args.endDate) },
  };

  const where =
    args.memberId && args.includeAsParticipant
      ? {
          ...base,
          OR: [
            { memberId: args.memberId },
            { responsibleMemberId: args.memberId },
            { participants: { some: { memberId: args.memberId } } },
          ],
        }
      : args.memberId
        ? { ...base, memberId: args.memberId }
        : base;

  const events = await prisma.calendarEvent.findMany({
    where,
    include: {
      member: true,
      responsible: true,
      participants: { include: { member: { select: { id: true, name: true, color: true } } } },
    },
    orderBy: { startsAt: "asc" },
  });

  const tz = await getHouseholdTZ(ctx.householdId);
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    eventType: e.eventType,
    member: e.member?.name ?? "Familia",
    responsible: e.responsible?.name ?? null,
    startsAt: toLocalISO(e.startsAt, tz),
    endsAt: toLocalISO(e.endsAt, tz),
    allDay: e.allDay,
    location: e.location,
    notes: e.notes,
    participants: e.participants.map((p) => ({
      name: p.member.name,
      role: p.role,
      rsvpStatus: p.rsvpStatus,
      color: p.member.color,
    })),
  }));
}

// -------------------------------------------------------------------------
// ACTUALIZAR EVENTO
// -------------------------------------------------------------------------

export async function updateCalendarEventTool(
  args: {
    eventId: string;
    title?: string;
    startDateTime?: string;
    endDateTime?: string;
    location?: string;
    notes?: string;
    status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  },
  ctx: AgentContext,
) {
  const event = await prisma.calendarEvent.findFirst({
    where: { id: args.eventId, householdId: ctx.householdId },
    include: { memberCalendar: true },
  });
  if (!event)
    return {
      error: "Evento no encontrado",
      hint: `El eventId '${args.eventId}' no corresponde a ningún CalendarEvent del hogar. Llamá list_family_events con el rango de fechas aproximado del evento para obtener el id correcto, luego llamá update_family_event con ese id.`,
    };

  // When only startDateTime is given, preserve the original duration
  let newStartsAt: Date | undefined;
  let newEndsAt: Date | undefined;
  if (args.startDateTime) {
    newStartsAt = new Date(args.startDateTime);
    if (args.endDateTime) {
      newEndsAt = new Date(args.endDateTime);
    } else {
      const durationMs = event.endsAt.getTime() - event.startsAt.getTime();
      newEndsAt = new Date(newStartsAt.getTime() + durationMs);
    }
  } else if (args.endDateTime) {
    newEndsAt = new Date(args.endDateTime);
  }

  const updated = await prisma.calendarEvent.update({
    where: { id: args.eventId },
    data: {
      ...(args.title && { title: args.title }),
      ...(newStartsAt && { startsAt: newStartsAt }),
      ...(newEndsAt && { endsAt: newEndsAt }),
      ...(args.location !== undefined && { location: args.location }),
      ...(args.notes !== undefined && { notes: args.notes }),
      ...(args.status && { status: args.status }),
    },
  });

  // Auto-sync update to Google Calendar if linked
  let googleCalendarSync: { synced: boolean; error?: string } = { synced: false };
  if (event.externalEventId && event.memberCalendar?.googleCalendarId) {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
    if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
      try {
        const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
        auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
        const cal = google.calendar({ version: "v3", auth });
        const tz = await getHouseholdTZ(ctx.householdId);
        await cal.events.patch({
          calendarId: event.memberCalendar.googleCalendarId,
          eventId: event.externalEventId,
          requestBody: {
            ...(args.title && { summary: args.title }),
            ...(newStartsAt && { start: { dateTime: newStartsAt.toISOString(), timeZone: tz } }),
            ...(newEndsAt && { end: { dateTime: newEndsAt.toISOString(), timeZone: tz } }),
            ...(args.location !== undefined && { location: args.location ?? undefined }),
          },
        });
        googleCalendarSync = { synced: true };
      } catch (err) {
        console.error("[updateCalendarEventTool] GCal sync error:", err);
        googleCalendarSync = { synced: false, error: "Google Calendar update failed" };
      }
    }
  }

  return {
    eventId: updated.id,
    title: updated.title,
    status: updated.status,
    googleCalendarSync,
  };
}

// -------------------------------------------------------------------------
// ELIMINAR EVENTO
// -------------------------------------------------------------------------

export async function deleteCalendarEventTool(args: { eventId: string }, ctx: AgentContext) {
  const event = await prisma.calendarEvent.findFirst({
    where: { id: args.eventId, householdId: ctx.householdId },
    include: { memberCalendar: true },
  });
  if (!event)
    return {
      error: "Evento no encontrado",
      hint: `El eventId '${args.eventId}' no corresponde a ningún CalendarEvent del hogar. Llamá list_family_events con el rango de fechas aproximado del evento para obtener el id correcto, luego llamá delete_family_event con ese id.`,
    };

  await prisma.calendarEvent.delete({ where: { id: args.eventId } });

  // Auto-sync deletion to Google Calendar if linked
  let googleCalendarSync: { synced: boolean; error?: string } = { synced: false };
  if (event.externalEventId && event.memberCalendar?.googleCalendarId) {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
    if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
      try {
        const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
        auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
        const cal = google.calendar({ version: "v3", auth });
        await cal.events.delete({
          calendarId: event.memberCalendar.googleCalendarId,
          eventId: event.externalEventId,
        });
        googleCalendarSync = { synced: true };
      } catch (err) {
        console.error("[deleteCalendarEventTool] GCal sync error:", err);
        googleCalendarSync = { synced: false, error: "Google Calendar deletion failed" };
      }
    }
  }

  return {
    deleted: true,
    title: event.title,
    googleCalendarSync,
  };
}

// -------------------------------------------------------------------------
// BUSCAR HORARIOS LIBRES -- disponibilidad de TODOS los participantes
// -------------------------------------------------------------------------

export async function findFreeSlotsTool(
  args: {
    startDate: string;
    endDate: string;
    durationMinutes: number;
    participantIds?: string[];
    memberId?: string;
  },
  ctx: AgentContext,
) {
  const start = new Date(args.startDate);
  const end = new Date(args.endDate);
  const tz = await getHouseholdTZ(ctx.householdId);

  const allParticipants = new Set<string>(args.participantIds ?? []);
  if (args.memberId) allParticipants.add(args.memberId);

  const busyWhere =
    allParticipants.size > 0
      ? buildParticipantFilter(ctx.householdId, start, end, Array.from(allParticipants))
      : { householdId: ctx.householdId, startsAt: { gte: start }, endsAt: { lte: end } };

  const busy = await prisma.calendarEvent.findMany({
    where: busyWhere,
    orderBy: { startsAt: "asc" },
    select: { startsAt: true, endsAt: true },
  });

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
        slots.push({ start: toLocalISO(cursor, tz), end: toLocalISO(slotEnd, tz) });
        cursor = slotEnd;
        continue;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(8, 0, 0, 0);
  }

  return { slots, checkedParticipants: Array.from(allParticipants) };
}

// -------------------------------------------------------------------------
// DETECTAR CONFLICTOS -- chequea TODOS los participantes indicados
// -------------------------------------------------------------------------

export async function checkConflictsTool(
  args: {
    startDateTime: string;
    endDateTime: string;
    participantIds?: string[];
    memberId?: string;
  },
  ctx: AgentContext,
) {
  const start = new Date(args.startDateTime);
  const end = new Date(args.endDateTime);

  const allParticipants = new Set<string>(args.participantIds ?? []);
  if (args.memberId) allParticipants.add(args.memberId);

  const where =
    allParticipants.size > 0
      ? buildParticipantFilter(ctx.householdId, start, end, Array.from(allParticipants))
      : { householdId: ctx.householdId, startsAt: { lt: end }, endsAt: { gt: start } };

  const conflicts = await prisma.calendarEvent.findMany({
    where,
    include: { member: true, responsible: true, participants: { include: { member: true } } },
    orderBy: { startsAt: "asc" },
  });

  const tz = await getHouseholdTZ(ctx.householdId);
  return {
    hasConflicts: conflicts.length > 0,
    count: conflicts.length,
    checkedParticipants: Array.from(allParticipants),
    conflicts: conflicts.map((e) => ({
      id: e.id,
      title: e.title,
      member: e.member?.name ?? "Familia",
      responsible: e.responsible?.name ?? null,
      startsAt: toLocalISO(e.startsAt, tz),
      endsAt: toLocalISO(e.endsAt, tz),
      affectedParticipants: e.participants
        .filter((p) => allParticipants.has(p.memberId))
        .map((p) => p.member.name),
    })),
  };
}

// -------------------------------------------------------------------------
// HELPER: filtro de conflictos para multiples participantes
// Detecta eventos donde ANY de los participantIds ocupa el horario:
//   - como beneficiario (memberId)
//   - como responsable (responsibleMemberId)
//   - como participante directo (CalendarEventParticipant)
// -------------------------------------------------------------------------
function buildParticipantFilter(
  householdId: string,
  start: Date,
  end: Date,
  participantIds: string[],
) {
  return {
    householdId,
    startsAt: { lt: end },
    endsAt: { gt: start },
    OR: [
      { memberId: { in: participantIds } },
      { responsibleMemberId: { in: participantIds } },
      { participants: { some: { memberId: { in: participantIds } } } },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRM EVENT CANDIDATE (from inbox)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates an EventCandidate produced by the inbox agent and creates the calendar event.
 * This is the structured entry point for inbox→calendar handoff.
 */
export async function confirmEventCandidateTool(
  args: {
    title: string;
    startAt: string; // ISO 8601
    endAt?: string; // ISO 8601
    location?: string;
    memberId?: string;
    notes?: string;
    /** Original confidence from inbox agent (0–1). Stored in description for traceability. */
    confidence?: number;
    source?: "email" | "web" | "pdf" | "image" | "manual";
  },
  ctx: AgentContext,
) {
  // Derive a sensible default end time if not provided (1 hour after start)
  const startDate = new Date(args.startAt);
  const endDate = args.endAt
    ? new Date(args.endAt)
    : new Date(startDate.getTime() + 60 * 60 * 1000);

  const description = [
    args.notes,
    args.source ? `Fuente: ${args.source}` : null,
    args.confidence !== undefined ? `Confianza: ${Math.round(args.confidence * 100)}%` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return createCalendarEventTool(
    {
      title: args.title,
      description: description || undefined,
      startDateTime: startDate.toISOString(),
      endDateTime: endDate.toISOString(),
      location: args.location,
      memberId: args.memberId,
      eventType: "SCHOOL",
      notes: args.notes,
    },
    ctx,
  );
}
