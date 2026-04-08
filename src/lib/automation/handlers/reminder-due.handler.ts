import prisma from "@/lib/database/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp/whatsapp-service";
import { sendEmail } from "@/lib/email/email-service";

/**
 * Handles "reminder.due" outbox events.
 *
 * Sends the reminder notification via the configured channel (WhatsApp or IN_APP).
 * Marks the reminder as SENT after successful delivery.
 *
 * Payload shape:
 *   { reminderId, memberId?, title, channel }
 */
export async function handleReminderDue(payload: Record<string, unknown>): Promise<void> {
  const reminderId = String(payload.reminderId ?? "");
  if (!reminderId) throw new Error("handleReminderDue: missing reminderId in payload");

  const reminder = await prisma.reminder.findUnique({
    where: { id: reminderId },
    include: {
      member: {
        include: { linkedUser: { select: { email: true } } },
      },
    },
  });

  if (!reminder) {
    // Already deleted or doesn't exist — not an error, just skip
    return;
  }

  if (reminder.status !== "PENDING") {
    // Already handled (SENT, DONE, DISMISSED) — skip
    return;
  }

  if (reminder.channel === "WHATSAPP") {
    const phone = reminder.member?.whatsappPhone;
    if (phone) {
      await sendWhatsAppMessage(phone, `🔔 ${reminder.title}`);
    }
  } else if (reminder.channel === "EMAIL") {
    // Prefer the member's explicit contact email; fall back to their linked User's auth email
    const email = reminder.member?.email ?? reminder.member?.linkedUser?.email ?? null;
    if (email) {
      await sendEmail({
        to: email,
        subject: `🔔 Recordatorio: ${reminder.title}`,
        text: reminder.description
          ? `${reminder.title}\n\n${reminder.description}`
          : reminder.title,
      });
    }
  }

  // For IN_APP and fallback: mark as sent (frontend polls pending reminders)
  await prisma.reminder.update({
    where: { id: reminderId },
    data: {
      status: "SENT",
      sent: true,
      sentAt: new Date(),
    },
  });
}
