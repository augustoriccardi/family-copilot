import prisma from "@/lib/database/prisma";
import { evaluateRules } from "../rules";
import { dispatch } from "../dispatcher";

/**
 * Handles "event.created" outbox events.
 *
 * Evaluates automation rules for the newly created event and queues
 * any resulting actions (e.g. auto-creating reminders).
 *
 * Payload shape:
 *   { eventId, householdId, memberId?, title, startsAt, eventType }
 */
export async function handleEventCreated(payload: Record<string, unknown>): Promise<void> {
  const householdId = String(payload.householdId ?? "");
  if (!householdId) throw new Error("handleEventCreated: missing householdId in payload");

  const actions = evaluateRules("event.created", payload);

  for (const { action, params } of actions) {
    if (action === "create_reminder") {
      const startsAt = new Date(String(payload.startsAt));
      const minutesBefore = Number(params.minutesBefore ?? 30);
      const dueAt = new Date(startsAt.getTime() - minutesBefore * 60 * 1000);

      // Only create reminder if due date is in the future
      if (dueAt <= new Date()) continue;

      const reminder = await prisma.reminder.create({
        data: {
          householdId,
          memberId: params.memberId ? String(params.memberId) : null,
          calendarEventId: params.eventId ? String(params.eventId) : null,
          title: String(params.title ?? "Recordatorio"),
          dueAt,
          minutesBefore,
          channel: "IN_APP",
          status: "PENDING",
        },
      });

      // Queue reminder notification for when it's due
      await dispatch(
        {
          type: "reminder.due",
          householdId,
          payload: {
            reminderId: reminder.id,
            memberId: reminder.memberId,
            title: reminder.title,
            channel: reminder.channel,
          },
          source: "cron",
          processAt: dueAt,
        },
      );
    }
  }
}
