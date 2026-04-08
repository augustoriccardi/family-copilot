import { NextRequest } from "next/server";
import { streamResponse } from "@/services/agentService";
import type { MessageResponse, FileAttachment } from "@/types/message";
import { resolveWebIdentity } from "@/lib/identity/web-identity";
import prisma from "@/lib/database/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE endpoint that streams incremental AI response chunks produced by the LangGraph React agent.
 * Query params:
 *  - content: user message text
 *  - threadId: conversation thread ID
 *  - callerId/callerName/callerRole: web UI identity (replaced by auth session when auth is added)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userContent = searchParams.get("content") || "";
  const threadId = searchParams.get("threadId") || "unknown";
  const model = searchParams.get("model") || undefined;
  const clientProvider = searchParams.get("provider") || undefined;
  const allowTool = searchParams.get("allowTool") as "allow" | "deny" | null;
  const toolsParam = searchParams.get("tools") || "";
  const approveAllTools = searchParams.get("approveAllTools") === "true";
  const attachmentsParam = searchParams.get("attachments") || "";

  const tools = toolsParam
    ? toolsParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  // Parse attachments from JSON
  let attachments: FileAttachment[] | undefined;
  if (attachmentsParam) {
    try {
      attachments = JSON.parse(attachmentsParam);
    } catch (error) {
      console.error("Failed to parse attachments:", error);
    }
  }

  // Resolve who is talking and which household.
  // To switch to auth: update resolveWebIdentity() in src/lib/identity/web-identity.ts only.
  const { householdId, callerId, callerName, callerRole } = await resolveWebIdentity(req, threadId);

  // Load AI config saved in household preferences (provider, model, apiKey)
  let savedProvider: string | undefined;
  let savedModel: string | undefined;
  let savedApiKey: string | undefined;
  if (householdId) {
    const prefs = await prisma.householdPreferences
      .findUnique({
        where: { householdId },
        select: { aiProvider: true, aiModel: true, aiApiKey: true },
      })
      .catch(() => null);
    savedProvider = prefs?.aiProvider ?? undefined;
    savedModel = prefs?.aiModel ?? undefined;
    savedApiKey = prefs?.aiApiKey ?? undefined;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: MessageResponse) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Initial comment to establish stream
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Run the agent streaming in the background
      (async () => {
        try {
          const iterable = await streamResponse({
            threadId,
            userText: userContent,
            opts: {
              // Saved household config takes priority; client values are fallback only
              model: savedModel ?? model,
              provider: savedProvider ?? clientProvider,
              apiKey: savedApiKey,
              tools,
              allowTool: allowTool || undefined,
              approveAllTools,
              attachments,
              householdId,
              callerId,
              callerName,
              callerRole,
            },
          });
          for await (const chunk of iterable) {
            // Only forward AI/tool chunks; ignore human/system
            if (chunk.type === "ai" || chunk.type === "tool") {
              send(chunk);
              // Persist agentName to DB on first chunk of each AI message.
              // This is the authoritative source — avoids fragile frontend positional indexing.
              if (chunk.type === "ai" && chunk.agentName && chunk.data?.id) {
                prisma.messageMetadata
                  .upsert({
                    where: {
                      threadId_messageId: { threadId, messageId: chunk.data.id },
                    },
                    create: { threadId, messageId: chunk.data.id, agentName: chunk.agentName },
                    update: {},
                  })
                  .catch(() => {
                    // Non-fatal: avatar will fall back to default icon
                  });
              }
            }
          }

          // Signal completion
          controller.enqueue(encoder.encode("event: done\n"));
          controller.enqueue(encoder.encode("data: {}\n\n"));
        } catch (err: unknown) {
          // Emit an error event (client onerror will capture general network; providing data for diagnostics)
          controller.enqueue(encoder.encode("event: error\n"));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ message: (err as Error)?.message || "Stream error", threadId })}\n\n`,
            ),
          );
        } finally {
          try {
            controller.close();
          } catch {
            // Controller already closed (client disconnected)
          }
        }
      })();
    },
    cancel() {
      // Client disconnected — the async loop above will stop on next enqueue attempt
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
