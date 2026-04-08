import { NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";
import { resolveHouseholdId } from "@/lib/tools/family/index";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Webhook endpoint for external triggers (n8n, Zapier, etc.).
 *
 * POST /api/webhooks/automation
 * Authorization: Bearer <AUTOMATION_WEBHOOK_SECRET>
 *
 * Body:
 * {
 *   "type": "inbox.email_received" | "inbox.page_scraped" | ...,
 *   "payload": { ... },
 *   "source": "n8n",
 *   "householdId": "..." (optional, defaults to first household)
 * }
 *
 * Returns 200 immediately. Processing happens asynchronously via cron-pump.
 */
export async function POST(request: Request) {
  // Validate bearer token
  const secret = process.env.AUTOMATION_WEBHOOK_SECRET;
  if (secret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { type, payload, source, householdId: bodyHouseholdId } =
    body as Record<string, unknown>;

  if (!type || typeof type !== "string") {
    return NextResponse.json({ error: "Missing required field: type" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Missing required field: payload (object)" }, { status: 400 });
  }

  // Resolve householdId
  const householdId =
    typeof bodyHouseholdId === "string"
      ? bodyHouseholdId
      : await resolveHouseholdId();

  if (!householdId) {
    return NextResponse.json({ error: "No household found" }, { status: 400 });
  }

  const eventSource = typeof source === "string" ? source : "webhook";

  await prisma.automationOutbox.create({
    data: {
      householdId,
      type,
      payload: payload as Record<string, unknown>,
      source: eventSource,
    },
  });

  return NextResponse.json({ queued: true }, { status: 200 });
}
