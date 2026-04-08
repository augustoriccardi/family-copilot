import prisma from "@/lib/database/prisma";
import type { Prisma } from "@prisma/client";

export type AutomationEventType =
  | "proposal.approved"
  | "event.created"
  | "event.starting_soon"
  | "reminder.due"
  | "inbox.email_received"
  | "inbox.page_scraped"
  | "webhook.n8n_trigger"
  | "proposal.expired";

export type AutomationSource = "agent" | "cron" | "webhook" | "poller";

export interface AutomationEvent {
  type: AutomationEventType;
  householdId: string;
  payload: Record<string, unknown>;
  source: AutomationSource;
  /** Defaults to now(). Set a future date for delayed processing. */
  processAt?: Date;
}

/**
 * Inserts an event into automation_outbox.
 *
 * For atomicity, pass a Prisma transaction client (tx) so the outbox write
 * is part of the same transaction as the main domain action.
 * If no tx is provided, the write is best-effort.
 */
export async function dispatch(
  event: AutomationEvent,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = (tx as typeof prisma) ?? prisma;
  await client.automationOutbox.create({
    data: {
      householdId: event.householdId,
      type: event.type,
      payload: event.payload as Prisma.InputJsonObject,
      source: event.source,
      processAt: event.processAt ?? new Date(),
    },
  });
}
