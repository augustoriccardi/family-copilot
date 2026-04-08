import { NextResponse } from "next/server";
import { runGmailPoller } from "@/lib/automation/pollers/gmail-poller";
import { runWebScraperPoller } from "@/lib/automation/pollers/web-scraper";
import prisma from "@/lib/database/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Cron endpoint: runs all configured pollers (Gmail labels, web scraper).
 * Inserts "inbox.email_received" / "inbox.page_scraped" events into automation_outbox
 * for the pump to process.
 *
 * Schedule: every 5 minutes (configured in vercel.json)
 *
 * Security: protected by CRON_SECRET header (set by Vercel Cron automatically).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all households with active watched sources
  const households = await prisma.watchedSource.findMany({
    where: { enabled: true },
    select: { householdId: true },
    distinct: ["householdId"],
  });

  const results: Record<string, { gmail?: number; scraper?: number; error?: string }> = {};

  for (const { householdId } of households) {
    try {
      const gmailResult = await runGmailPoller(householdId);
      const scraperResult = await runWebScraperPoller(householdId);
      results[householdId] = { gmail: gmailResult.queued, scraper: scraperResult.queued };
    } catch (err) {
      results[householdId] = { error: (err as Error).message };
    }
  }

  return NextResponse.json({ polled: households.length, results });
}
