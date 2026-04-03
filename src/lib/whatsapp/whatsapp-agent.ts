/**
 * Bridge between an incoming WhatsApp message and the LangGraph Family Copilot agent.
 *
 * Responsibilities:
 * - Resolve household + thread for the sender's phone number
 * - Auto-provision a new household on first contact if none exists
 * - Ensure the thread exists in Prisma (linked to the household)
 * - Run the agent via streamResponse() with approveAllTools=true
 *   (WhatsApp is a headless channel — no UI to show approval buttons)
 * - Accumulate all streamed text chunks into a single reply string
 * - Return the final text to the caller so it can be sent back via WhatsApp
 */

import { streamResponse } from "@/services/agentService";
import { resolveWhatsAppIdentity, provisionNewHousehold } from "./whatsapp-resolver";
import prisma from "@/lib/database/prisma";

const WELCOME_MESSAGE = `👋 ¡Bienvenido a *Family Copilot*!

Creé un hogar para vos automáticamente. Podés personalizarlo desde la app web.

¿En qué te puedo ayudar hoy? Puedo gestionar:
📅 Calendario familiar
🔔 Recordatorios
🍳 Recetas
🛒 Lista de compras
👨‍👩‍👧 Información del hogar`;

/**
 * Processes an incoming WhatsApp text message end-to-end.
 * Returns the agent's reply as a plain string, or null if nothing to send.
 */
export async function handleWhatsAppMessage(
  fromPhone: string,
  userText: string,
): Promise<string | null> {
  if (!userText.trim()) return null;

  // 1. Resolve which household + thread to use; auto-provision on first contact
  let identity = await resolveWhatsAppIdentity(fromPhone);

  if (!identity) {
    identity = await provisionNewHousehold(fromPhone);
  }

  const { householdId, threadId, isNewHousehold, callerId, callerRole } = identity;

  // 2. Ensure the thread exists and is linked to the household
  await prisma.thread.upsert({
    where: { id: threadId },
    create: {
      id: threadId,
      title: userText.substring(0, 80),
      householdId,
    },
    update: {
      householdId,
    },
  });

  // 3. For brand-new households, send a welcome message first
  if (isNewHousehold) {
    return WELCOME_MESSAGE;
  }

  // 4. Stream through the agent — collect all text chunks
  const iterable = await streamResponse({
    threadId,
    userText,
    opts: {
      householdId,
      callerId,
      callerName: identity.displayName,
      callerRole,
      // Tools run automatically — no human-in-the-loop approval in WhatsApp channel
      approveAllTools: true,
    },
  });

  const parts: string[] = [];
  for await (const chunk of iterable) {
    if (chunk.type === "ai") {
      const content = (chunk.data as { content?: string }).content;
      if (content && content.trim()) {
        parts.push(content);
      }
    }
  }

  const reply = parts.join("").trim();
  return reply.length > 0 ? reply : null;
}
