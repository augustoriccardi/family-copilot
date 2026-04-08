import { resolveHouseholdId } from "@/lib/tools/family/index";
import { buildInboxAgent } from "@/lib/agent/subagents/inbox";
import { HumanMessage } from "@langchain/core/messages";

/**
 * Handles "inbox.email_received" outbox events.
 *
 * Passes the email content to the inbox agent (LLM) which applies the
 * confidence-based rule to decide:
 *   - confidence >= 0.9 + title + date + hour → create_proposal → approve_proposal (direct event)
 *   - confidence < 0.9 or missing fields     → create_proposal (PENDING, user reviews)
 *
 * Payload shape:
 *   { emailId, memberId?, sourceId, sourceName, subject, from, date, body }
 */
export async function handleInboxEmail(payload: Record<string, unknown>): Promise<void> {
  const householdId = await resolveHouseholdId();
  if (!householdId) throw new Error("handleInboxEmail: no household configured");

  const subject = String(payload.subject ?? "");
  const from = String(payload.from ?? "");
  const date = String(payload.date ?? "");
  const body = String(payload.body ?? "");
  const sourceName = String(payload.sourceName ?? "correo");
  const memberId = payload.memberId ? String(payload.memberId) : undefined;

  // Build the message that simulates the user pasting this email into the chat
  const content = [
    `📬 Nuevo email de "${sourceName}" recibido automáticamente para procesar:`,
    ``,
    `**De:** ${from}`,
    `**Asunto:** ${subject}`,
    `**Fecha:** ${date}`,
    ``,
    `**Contenido:**`,
    body,
    ``,
    memberId ? `memberId del destinatario: ${memberId}` : "",
    ``,
    `Analizá el contenido y creá propuestas para cualquier evento, aviso o recordatorio que encuentres.`,
  ]
    .filter(Boolean)
    .join("\n");

  const agent = await buildInboxAgent([], householdId, undefined, undefined);

  // Use a dedicated thread per email to avoid polluting conversation history
  const threadId = `poller-email-${String(payload.emailId ?? Date.now())}`;
  const config = { configurable: { thread_id: threadId } };

  await agent.invoke({ messages: [new HumanMessage(content)] }, config);
}
