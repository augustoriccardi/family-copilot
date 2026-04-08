import { resolveHouseholdId } from "@/lib/tools/family/index";
import { buildInboxAgent } from "@/lib/agent/subagents/inbox";
import { HumanMessage } from "@langchain/core/messages";

/**
 * Handles "inbox.page_scraped" outbox events.
 *
 * Passes the scraped events to the inbox agent (LLM) which applies the
 * confidence-based rule to decide: direct event vs pending proposal.
 *
 * Payload shape:
 *   { url, sourceId, sourceName, memberId?, events: [{title, date, description?, location?}] }
 */
export async function handleInboxPage(payload: Record<string, unknown>): Promise<void> {
  const householdId = await resolveHouseholdId();
  if (!householdId) throw new Error("handleInboxPage: no household configured");

  const sourceName = String(payload.sourceName ?? "página web");
  const url = String(payload.url ?? "");
  const memberId = payload.memberId ? String(payload.memberId) : undefined;
  const events = Array.isArray(payload.events) ? payload.events : [];

  if (events.length === 0) return;

  const eventsText = events
    .map((e, i) => {
      const ev = e as Record<string, unknown>;
      return `${i + 1}. **${ev.title}** — ${ev.date}${ev.location ? ` @ ${ev.location}` : ""}${ev.description ? `\n   ${ev.description}` : ""}`;
    })
    .join("\n");

  const content = [
    `📅 Eventos detectados automáticamente en "${sourceName}" (${url}):`,
    ``,
    eventsText,
    ``,
    memberId ? `memberId del destinatario: ${memberId}` : "",
    ``,
    `Creá propuestas para cada evento que sea relevante para la familia.`,
  ]
    .filter(Boolean)
    .join("\n");

  const agent = await buildInboxAgent([], householdId, undefined, undefined);

  const threadId = `poller-page-${String(payload.sourceId ?? Date.now())}`;
  const config = { configurable: { thread_id: threadId } };

  await agent.invoke({ messages: [new HumanMessage(content)] }, config);
}
