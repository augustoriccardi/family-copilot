import { ensureAgent } from "@/lib/agent";
import { ensureThread } from "@/lib/thread";
import type { MessageOptions, MessageResponse, ToolCall } from "@/types/message";
import prisma from "@/lib/database/prisma";
import { getHistory } from "@/lib/agent/memory";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { processAttachmentsForAI } from "@/lib/storage/content";

/**
 * Returns an async iterable producing incremental AI text chunks for a user text input.
 * Thread is ensured before streaming. The consumer (route) can package into SSE or any protocol.
 */
export async function streamResponse(params: {
  threadId: string;
  userText: string;
  opts?: MessageOptions;
}) {
  const { threadId, userText, opts } = params;
  await ensureThread(threadId, userText);

  // ── CAMINO 1: Reanudación tras aprobación de tool ────────────────────────
  // Cuando el usuario aprueba o rechaza un tool call, el grafo está PAUSADO
  // en un interrupt() esperando una respuesta. No hay mensaje nuevo del usuario.
  // Se usa Command({ resume }) para continuar desde el nodo pausado, NO desde START.
  // Enviar un HumanMessage en este estado causaría un error de LangGraph.
  if (opts?.allowTool) {
    const inputs = new Command({
      resume: {
        // "continue" → ejecutar el tool | "deny" → rechazar y volver al agente
        action: opts.allowTool === "allow" ? "continue" : "deny",
        data: {},
      },
    });

    const agent = await ensureAgent({
      model: opts?.model,
      provider: opts?.provider,
      apiKey: opts?.apiKey,
      tools: opts?.tools,
      approveAllTools: opts?.approveAllTools,
      householdId: opts?.householdId,
      callerId: opts?.callerId,
      callerName: opts?.callerName,
      callerRole: opts?.callerRole,
    });

    // thread_id le indica a LangGraph qué checkpoint reanudar en Postgres
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iterable = await agent.stream(inputs as any, {
      streamMode: ["updates"],
      configurable: { thread_id: threadId },
      recursionLimit: 50,
    });

    return generator(iterable);
  }

  // ── CAMINO 2: Mensaje nuevo del usuario ──────────────────────────────────
  // El grafo arranca desde START con el mensaje del usuario como input.
  // El content puede ser string simple o array multimodal (texto + imágenes/PDFs).
  // OpenAI y Gemini aceptan ambos formatos, pero el array es obligatorio para archivos.
  let messageContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

  if (opts?.attachments && opts.attachments.length > 0) {
    // Images and PDFs are analyzed via the analyze_image_content tool (which calls vision internally).
    // We only pass a metadata block so the inbox agent knows the fileKey to use — no base64 in state.
    // Text files are still inlined since they're small and don't cause context explosion.
    const textAttachments = opts.attachments.filter(
      (a) => !a.type.startsWith("image/") && a.type !== "application/pdf",
    );
    const mediaAttachments = opts.attachments.filter(
      (a) => a.type.startsWith("image/") || a.type === "application/pdf",
    );

    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: "text", text: userText },
    ];

    if (mediaAttachments.length > 0) {
      const fileMetaBlock =
        `[Adjuntos para analyze_image_content — usá el fileKey exacto de esta lista:\n` +
        mediaAttachments
          .map((a) => `  fileKey="${a.key}" mimeType="${a.type}" name="${a.name}"`)
          .join("\n") +
        `\nNUNCA inventes ni adivines el fileKey — usá el valor literal de arriba.]`;
      contentParts.push({ type: "text", text: fileMetaBlock });
    }

    if (textAttachments.length > 0) {
      const textContents = await processAttachmentsForAI(textAttachments);
      contentParts.push(...textContents);
    }

    messageContent = contentParts;
  } else {
    // Texto puro: string es más limpio y evita overhead de parsing en el LLM
    messageContent = userText;
  }

  const inputs = {
    // MessagesAnnotation espera { messages: BaseMessage[] }
    messages: [new HumanMessage({ content: messageContent })],
  };

  const agent = await ensureAgent({
    model: opts?.model,
    provider: opts?.provider,
    apiKey: opts?.apiKey,
    tools: opts?.tools,
    approveAllTools: opts?.approveAllTools,
    householdId: opts?.householdId,
    callerId: opts?.callerId,
    callerName: opts?.callerName,
    callerRole: opts?.callerRole,
  });

  // thread_id vincula esta ejecución con el historial guardado en Postgres.
  // LangGraph carga el checkpoint anterior y agrega el nuevo mensaje al estado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iterable = await agent.stream(inputs as any, {
    streamMode: ["updates"],
    configurable: { thread_id: threadId },
    recursionLimit: 50,
  });

  return generator(iterable);
}

/**
 * Nodos cuyos AIMessages se exponen al frontend.
 * "supervisor" está incluido para capturar respuestas directas (ej: saludos).
 * Sus mensajes de routing (tool_calls transfer_to_*) se filtran más abajo.
 */
const VISIBLE_NODES = new Set([
  "supervisor",
  "calendar",
  "inbox",
  "family",
  "library",
  "reminder",
  "notification",
  "recipe",
  "shopping",
]);

// Transforma el stream crudo de LangGraph (formato "updates") en MessageResponse
// que el frontend puede consumir directamente.
//
// LangGraph emite objetos con forma: ["updates", { "<nodeName>": { messages: [...] } }]
// donde <nodeName> es el nodo del grafo que produjo el update ("agent", "recipe", etc.).
// También puede emitir ["updates", { "__interrupt__": [...] }] cuando el grafo se pausa.
async function* generator(
  iterable: AsyncIterable<unknown>,
): AsyncGenerator<MessageResponse, void, unknown> {
  for await (const chunk of iterable) {
    if (!chunk) continue;

    // LangGraph con streamMode "updates" emite tuplas [tipo, datos]
    if (Array.isArray(chunk) && chunk.length === 2) {
      const [chunkType, chunkData] = chunk;

      if (
        chunkType === "updates" &&
        chunkData &&
        typeof chunkData === "object" &&
        !Array.isArray(chunkData)
      ) {
        const updateMap = chunkData as Record<string, unknown>;

        // ── Interrupt: el grafo está pausado esperando aprobación ─────────────
        // Cuando un subagente necesita aprobación de tool, LangGraph pausa el grafo
        // y emite { "__interrupt__": [{value: {toolCall}}] } en vez de un nodo normal.
        // El AIMessage(tool_calls) del subagente NO es visible en el stream del padre
        // (requeriría subgraphs:true). Extraemos el toolCall del interrupt y lo
        // emitimos para que el frontend muestre el UI de aprobación.
        if ("__interrupt__" in updateMap) {
          const interrupts = updateMap["__interrupt__"];
          if (Array.isArray(interrupts) && interrupts.length > 0) {
            const interruptValue = (interrupts[0] as Record<string, unknown>)?.value as
              | Record<string, unknown>
              | undefined;
            const toolCall = interruptValue?.toolCall as ToolCall | undefined;
            if (toolCall?.id && toolCall?.name) {
              yield {
                type: "ai",
                agentName: "supervisor",
                data: {
                  id: toolCall.id,
                  content: "",
                  tool_calls: [toolCall],
                },
              };
            }
          }
          continue;
        }

        // ── Updates normales: nodos del grafo que produjeron mensajes ────────────
        // Cada key es el nombre del nodo ("agent", "recipe", "supervisor", etc.).
        // Solo se exponen los nodos VISIBLES: los que generan respuestas para el usuario.
        // El nodo "supervisor" se excluye porque solo hace routing interno (transfer_to_*).
        for (const [nodeName, nodeData] of Object.entries(updateMap)) {
          // Filtrar nodos de routing (supervisor) y nodos sin mensajes
          if (!VISIBLE_NODES.has(nodeName)) continue;
          if (!nodeData || typeof nodeData !== "object" || Array.isArray(nodeData)) continue;
          if (!("messages" in nodeData)) continue;

          const messages = Array.isArray((nodeData as Record<string, unknown>).messages)
            ? ((nodeData as Record<string, unknown>).messages as unknown[])
            : [(nodeData as Record<string, unknown>).messages];

          for (const message of messages) {
            if (!message) continue;

            const isAIMessage =
              (message as Record<string, unknown>)?.constructor?.name === "AIMessageChunk" ||
              (message as Record<string, unknown>)?.constructor?.name === "AIMessage";

            if (!isAIMessage) continue;

            const processedMessage = processAIMessage(message as Record<string, unknown>, nodeName);
            if (processedMessage) {
              yield processedMessage;
            }
          }
        }
      }
    }
  }
}

// Helper function to process any AI message and return the appropriate MessageResponse
function processAIMessage(
  message: Record<string, unknown>,
  agentName?: string,
): MessageResponse | null {
  const toolCalls =
    Array.isArray(message.tool_calls) && message.tool_calls.length > 0
      ? (message.tool_calls as ToolCall[])
      : undefined;

  // Check if this is a tool call (OpenAI format: tool_calls array, or Gemini format: functionCall in content)
  const hasGeminiFunctionCall =
    Array.isArray(message.content) &&
    message.content.some(
      (item: unknown) => item && typeof item === "object" && "functionCall" in item,
    );

  if (toolCalls || hasGeminiFunctionCall) {
    // Return full AIMessageData for tool calls to preserve all information
    return {
      type: "ai",
      agentName,
      data: {
        id: (message.id as string) || Date.now().toString(),
        content: typeof message.content === "string" ? message.content : "",
        tool_calls: toolCalls,
        additional_kwargs: (message.additional_kwargs as Record<string, unknown>) || undefined,
        response_metadata: (message.response_metadata as Record<string, unknown>) || undefined,
      },
    };
  } else {
    // Handle regular text content - extract text from various content types
    let text = "";
    if (typeof message.content === "string") {
      text = message.content;
    } else if (Array.isArray(message.content)) {
      text = message.content
        .map((c: string | { text?: string }) => (typeof c === "string" ? c : c?.text || ""))
        .join("");
    } else {
      text = String(message.content ?? "");
    }

    // Only return message if we have actual text content
    if (text.trim()) {
      return {
        type: "ai",
        agentName,
        data: { id: (message.id as string) || Date.now().toString(), content: text },
      };
    }
  }
  return null;
}

/** Fetch prior messages for a thread from the LangGraph checkpoint/memory system. */
export async function fetchThreadHistory(threadId: string): Promise<MessageResponse[]> {
  const thread = await prisma.thread.findUnique({ where: { id: threadId } });
  if (!thread) return [];
  try {
    const [history, metadataRows] = await Promise.all([
      getHistory(threadId),
      prisma.messageMetadata.findMany({
        where: { threadId },
        select: { messageId: true, agentName: true },
      }),
    ]);

    // Build a lookup map: messageId → agentName
    const agentNameByMessageId = new Map(metadataRows.map((r) => [r.messageId, r.agentName]));

    return history.map((msg: BaseMessage) => {
      const dict = msg.toDict() as MessageResponse;
      const messageId = (dict.data as { id?: string })?.id;
      if (messageId && agentNameByMessageId.has(messageId)) {
        dict.agentName = agentNameByMessageId.get(messageId);
      }
      return dict;
    });
  } catch (e) {
    console.error("fetchThreadHistory error", e);
    return [];
  }
}
