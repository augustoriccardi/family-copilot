import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";
import { google } from "googleapis";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getLinkedMember(userId: string) {
  return prisma.familyMember.findFirst({
    where: { linkedUserId: userId },
    select: { id: true },
  });
}

async function getConnection(userId: string) {
  return prisma.calendarConnection.findFirst({
    where: { userId, provider: "google" },
  });
}

/**
 * GET /api/google/member-calendars
 *   ?source=google  → list calendars from the user's connected Google account
 *   (no param)      → list saved MemberCalendar rows for the linked member
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const source = new URL(req.url).searchParams.get("source");

  if (source === "google") {
    const connection = await getConnection(session.user.id);
    if (!connection?.refreshToken) {
      return NextResponse.json({ calendars: [], notConnected: true });
    }

    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return NextResponse.json({ error: "Google no configurado en el servidor" }, { status: 500 });
    }

    try {
      const oauthClient = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      oauthClient.setCredentials({ refresh_token: connection.refreshToken });
      const cal = google.calendar({ version: "v3", auth: oauthClient });
      const { data } = await cal.calendarList.list({ maxResults: 50 });
      const calendars = (data.items ?? []).map((c) => ({
        id: c.id!,
        summary: c.summary ?? c.id!,
        primary: c.primary ?? false,
        backgroundColor: c.backgroundColor ?? null,
      }));
      return NextResponse.json({ calendars });
    } catch (err) {
      console.error("Failed to fetch Google calendar list:", err);
      return NextResponse.json({ calendars: [], fetchError: true });
    }
  }

  // Default: return saved mappings for the linked member
  const member = await getLinkedMember(session.user.id);
  if (!member) {
    return NextResponse.json({ memberCalendars: [] });
  }

  const memberCalendars = await prisma.memberCalendar.findMany({
    where: { householdMemberId: member.id },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      googleCalendarId: true,
      displayName: true,
      type: true,
      isPrimary: true,
    },
  });

  return NextResponse.json({ memberCalendars });
}

const postSchema = z.object({
  googleCalendarId: z.string().min(1),
  displayName: z.string().max(100).optional(),
  type: z.enum(["PERSONAL", "FAMILY_SHARED"]),
  isPrimary: z.boolean().default(false),
});

/**
 * POST /api/google/member-calendars — save a new MemberCalendar mapping
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const member = await getLinkedMember(session.user.id);
  if (!member) {
    return NextResponse.json(
      { error: "Necesitás vincular tu perfil familiar primero" },
      { status: 409 },
    );
  }

  const connection = await getConnection(session.user.id);
  if (!connection) {
    return NextResponse.json(
      { error: "Necesitás conectar Google Calendar primero" },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { googleCalendarId, displayName, type, isPrimary } = parsed.data;

  // Guard against duplicates
  const existing = await prisma.memberCalendar.findFirst({
    where: { householdMemberId: member.id, googleCalendarId },
  });
  if (existing) {
    return NextResponse.json({ error: "Ya existe un mapeo para ese calendario" }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      // Clear existing isPrimary for this member
      await tx.memberCalendar.updateMany({
        where: { householdMemberId: member.id },
        data: { isPrimary: false },
      });
    }
    await tx.memberCalendar.create({
      data: {
        householdMemberId: member.id,
        calendarConnectionId: connection.id,
        googleCalendarId,
        displayName: displayName ?? null,
        type,
        isPrimary,
      },
    });
  });

  // Return updated list
  const memberCalendars = await prisma.memberCalendar.findMany({
    where: { householdMemberId: member.id },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      googleCalendarId: true,
      displayName: true,
      type: true,
      isPrimary: true,
    },
  });

  return NextResponse.json({ memberCalendars }, { status: 201 });
}
