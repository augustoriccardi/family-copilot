import type { AutomationOutbox } from "@prisma/client";
import { handleEventCreated } from "./handlers/event-created.handler";
import { handleReminderDue } from "./handlers/reminder-due.handler";
import { handleInboxEmail } from "./handlers/inbox-email.handler";
import { handleInboxPage } from "./handlers/inbox-page.handler";

/**
 * Routes an outbox event to the correct handler.
 * Called by the cron-pump for each PENDING outbox entry.
 *
 * Throws on unhandled event types so the pump can mark them as FAILED.
 */
export async function processEvent(event: AutomationOutbox): Promise<void> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.type) {
    case "event.created":
      await handleEventCreated(payload);
      break;

    case "reminder.due":
      await handleReminderDue(payload);
      break;

    case "inbox.email_received":
      await handleInboxEmail(payload);
      break;

    case "inbox.page_scraped":
      await handleInboxPage(payload);
      break;

    case "webhook.n8n_trigger":
    case "proposal.approved":
    case "event.starting_soon":
    case "proposal.expired":
      console.log(`[automation] event type "${event.type}" not yet handled — skipping`);
      break;

    default:
      throw new Error(`[automation] unknown event type: "${event.type}"`);
  }
}
