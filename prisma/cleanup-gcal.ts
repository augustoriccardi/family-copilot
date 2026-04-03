/**
 * Deletes all CalendarEvents from Google Calendar that have an externalEventId,
 * then optionally resets the DB.
 *
 * Usage:
 *   pnpm exec tsx prisma/cleanup-gcal.ts
 *
 * Run this BEFORE pnpm prisma:seed:reset to avoid orphaned events in Google Calendar.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";

const prisma = new PrismaClient();

async function main() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    console.error(
      "❌ Missing Google credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN in .env",
    );
    process.exit(1);
  }

  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const cal = google.calendar({ version: "v3", auth });

  // Find all events synced to Google Calendar
  const events = await prisma.calendarEvent.findMany({
    where: { externalEventId: { not: null } },
    select: {
      id: true,
      title: true,
      externalEventId: true,
      memberCalendar: { select: { googleCalendarId: true } },
    },
  });

  if (events.length === 0) {
    console.log("✅ No synced events found — nothing to delete.");
    return;
  }

  console.log(`🗑  Found ${events.length} event(s) to delete from Google Calendar:\n`);

  let deleted = 0;
  let failed = 0;

  for (const event of events) {
    const calendarId = event.memberCalendar?.googleCalendarId;
    if (!calendarId || !event.externalEventId) {
      console.log(`  ⚠️  Skipping "${event.title}" — missing calendarId or externalEventId`);
      failed++;
      continue;
    }

    try {
      await cal.events.delete({ calendarId, eventId: event.externalEventId });
      console.log(`  ✅ Deleted "${event.title}" (${event.externalEventId})`);
      deleted++;
    } catch (err: unknown) {
      // 410 Gone = already deleted in Google Calendar, safe to ignore
      const status = (err as { code?: number })?.code;
      if (status === 410 || status === 404) {
        console.log(`  ℹ️  "${event.title}" already gone from Google Calendar — skipping`);
        deleted++;
      } else {
        console.error(`  ❌ Failed to delete "${event.title}":`, err);
        failed++;
      }
    }
  }

  console.log(`\n📊 Done: ${deleted} deleted, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
