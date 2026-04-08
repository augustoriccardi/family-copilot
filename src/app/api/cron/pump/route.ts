import { NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";
import { processEvent } from "@/lib/automation/processor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;

/**
 * Cron endpoint: processes pending automation_outbox events.
 * Uses raw SQL for SELECT FOR UPDATE SKIP LOCKED to prevent double-processing
 * when multiple Vercel instances run concurrently.
 *
 * Schedule: every 1 minute (configured in vercel.json)
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

  const now = new Date();

  // Claim a batch of PENDING events atomically using SKIP LOCKED
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE automation_outbox
    SET status = 'PROCESSING', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM automation_outbox
      WHERE status = 'PENDING' AND process_at <= ${now}
      ORDER BY process_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `;

  if (claimed.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const ids = claimed.map((r) => r.id);

  const events = await prisma.automationOutbox.findMany({
    where: { id: { in: ids } },
  });

  let processed = 0;
  let failed = 0;

  await Promise.all(
    events.map(async (event) => {
      try {
        await processEvent(event);
        await prisma.automationOutbox.update({
          where: { id: event.id },
          data: { status: "DONE", processedAt: new Date() },
        });
        processed++;
      } catch (err) {
        const error = err as Error;
        console.error(`[cron/pump] event ${event.id} (${event.type}) failed:`, error.message);

        const nextAttempts = event.attempts; // already incremented by the UPDATE above
        const shouldRetry = nextAttempts < MAX_ATTEMPTS;

        // Exponential backoff: 1min, 5min, 30min
        const backoffMinutes = [1, 5, 30][Math.min(nextAttempts - 1, 2)];
        const processAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

        await prisma.automationOutbox.update({
          where: { id: event.id },
          data: {
            status: shouldRetry ? "PENDING" : "FAILED",
            processAt: shouldRetry ? processAt : undefined,
            lastError: error.message.substring(0, 500),
          },
        });
        failed++;
      }
    }),
  );

  return NextResponse.json({ processed, failed, total: events.length });
}
