import { DynamicStructuredTool, DynamicTool, StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { AgentBuilder } from "../builder";
import { postgresCheckpointer } from "../memory";
import {
  AgentConfigOptions,
  createChatModel,
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
} from "../util";
import { INBOX_AGENT_PROMPT } from "../prompts/inbox";
import { CallerInfo } from "../prompts/supervisor";
import {
  analyzeImageContentTool,
  parsePdfDocumentTool,
  listDocumentsForInboxTool,
} from "../../tools/inbox/index";
import { readGmailInboxTool } from "../../tools/inbox/gmail";
import {
  createProposalTool,
  listPendingProposalsTool,
  approveProposalTool,
  rejectProposalTool,
} from "../../tools/proposals/index";
import { ProposalType, Prisma } from "@prisma/client";
import { resolveHouseholdId, findFamilyMemberTool } from "../../tools/family/index";

/** Tool prefixes that belong to specialized agents and should be excluded from the inbox agent */
const SPECIALIZED_TOOL_PREFIXES = ["google-calendar", "google_calendar", "calendar"];

/**
 * Filters out tools reserved for specialized agents, leaving only general-purpose and vision tools.
 * The inbox agent receives all non-calendar tools (including any OCR/vision MCP tools).
 */
export function filterInboxTools(allTools: StructuredToolInterface[]): DynamicTool[] {
  return allTools.filter(
    (tool) =>
      !SPECIALIZED_TOOL_PREFIXES.some((prefix) => tool.name.toLowerCase().startsWith(prefix)),
  ) as DynamicTool[];
}

const NO_HOUSEHOLD = JSON.stringify({
  error:
    "No hay hogar configurado. Para usar funciones familiares, primero creá un hogar desde la interfaz web.",
});

function buildInboxTools(householdId: string | null) {
  const noHousehold = !householdId;
  const ctx = { householdId: householdId ?? "" };

  return [
    new DynamicStructuredTool({
      name: "analyze_image_content",
      description:
        "Resuelve un archivo de imagen o PDF ya subido al sistema (por su fileKey) y lo prepara para análisis. Úsalo cuando el usuario comparta una imagen, flyer o documento para extraer información estructurada (eventos, productos, avisos, vencimientos).",
      schema: z.object({
        fileKey: z
          .string()
          .describe("Clave S3/MinIO del archivo ya subido (ej: 'uploads/uuid.jpg')"),
        mimeType: z
          .string()
          .describe("Tipo MIME del archivo (ej: 'image/jpeg', 'application/pdf', 'text/plain')"),
        hint: z
          .string()
          .optional()
          .describe(
            "Pista opcional sobre qué tipo de contenido buscar (ej: 'evento escolar', 'lista de útiles')",
          ),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await analyzeImageContentTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "read_gmail_inbox",
      description:
        "Lee los correos recientes de Gmail del miembro del hogar identificado. Extrae emails no leídos y los devuelve estructurados (asunto, remitente, fecha, cuerpo) para que el agente detecte eventos, avisos escolares, vencimientos y otros candidatos relevantes.",
      schema: z.object({
        memberId: z
          .string()
          .optional()
          .describe(
            "ID del miembro del hogar cuyo correo leer (si se omite, usa el miembro activo en la sesión)",
          ),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Cantidad máxima de correos a leer (por defecto 20)"),
        query: z
          .string()
          .optional()
          .describe(
            "Filtro de búsqueda Gmail (ej: 'from:colegio', 'subject:reunión'). Por defecto: correos no leídos sin promociones.",
          ),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await readGmailInboxTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "parse_document",
      description:
        "Carga un documento ya guardado en la biblioteca del hogar (por su ID) y extrae su texto o imagen para análisis. Úsalo cuando el usuario pida analizar un documento guardado para detectar candidatos (eventos, productos, avisos).",
      schema: z.object({
        documentId: z.string().describe("ID del documento en la base de datos"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await parsePdfDocumentTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "list_documents",
      description:
        "Lista los documentos guardados en la biblioteca del hogar. Usalo para encontrar documentos disponibles para analizar.",
      schema: z.object({
        memberId: z
          .string()
          .optional()
          .describe("ID del miembro para filtrar documentos (opcional)"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await listDocumentsForInboxTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "create_proposal",
      description:
        "Crea una propuesta de acción pendiente de revisión. SIEMPRE usá esta herramienta cuando detectes un evento, recordatorio, compra o documento importante en una fuente externa (email, imagen, PDF, WhatsApp). NUNCA crees el evento/recordatorio directamente — el usuario debe revisarlo primero.",
      schema: z.object({
        type: z
          .enum(["EVENT", "REMINDER", "SHOPPING_ITEM", "DOCUMENT", "OTHER"])
          .describe(
            "Tipo de propuesta: EVENT para eventos o fechas, REMINDER para recordatorios, SHOPPING_ITEM para productos, DOCUMENT para documentos, OTHER para otras",
          ),
        title: z.string().describe("Título claro y conciso de la propuesta"),
        description: z.string().optional().describe("Descripción adicional de la propuesta"),
        // EVENT fields
        startDateTime: z
          .string()
          .optional()
          .describe(
            "REQUERIDO para type=EVENT. Fecha y hora de inicio en formato ISO 8601 (ej: '2026-04-15T18:00:00'). Si no tenés la hora exacta, usá T00:00:00.",
          ),
        endDateTime: z
          .string()
          .optional()
          .describe(
            "Fecha y hora de fin en ISO 8601. Para type=EVENT intentá incluirla si está disponible.",
          ),
        location: z
          .string()
          .optional()
          .describe("Lugar del evento (para type=EVENT, si está disponible)"),
        // REMINDER fields
        dueAt: z
          .string()
          .optional()
          .describe(
            "REQUERIDO para type=REMINDER. Fecha límite en ISO 8601 (ej: '2026-04-20T09:00:00').",
          ),
        // SHOPPING_ITEM fields
        itemName: z
          .string()
          .optional()
          .describe("Nombre del producto (para type=SHOPPING_ITEM, si difiere del title)"),
        quantity: z.string().optional().describe("Cantidad del producto (para type=SHOPPING_ITEM)"),
        unit: z.string().optional().describe("Unidad del producto (para type=SHOPPING_ITEM)"),
        // Common fields
        source: z
          .string()
          .describe(
            "Origen del evento detectado: 'email', 'pdf', 'image', 'whatsapp', 'web', 'manual'",
          ),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            "Confianza en la detección (0.0–1.0). Usá 0.9+ para datos claros y explícitos, 0.5–0.8 para datos parciales o ambiguos.",
          ),
        memberId: z
          .string()
          .optional()
          .describe(
            "ID del miembro de la familia al que aplica la propuesta — el dueño principal del evento (opcional)",
          ),
        participantIds: z
          .array(z.string())
          .optional()
          .describe(
            "IDs de los miembros que participan/asisten al evento (además del dueño). Usá find_family_member para resolver cada nombre antes de pasar el ID. Solo para type=EVENT.",
          ),
        notes: z
          .string()
          .optional()
          .describe("Nota interna explicando por qué detectaste esto como relevante"),
        sourceFileUrl: z
          .string()
          .optional()
          .describe(
            "URL pública del archivo fuente (imagen, PDF) del que extrajiste esta propuesta. Tomalo del campo `publicUrl` devuelto por analyze_image_content o parse_document.",
          ),
      }),
      func: async (args) => {
        if (noHousehold) return NO_HOUSEHOLD;
        // Build payload from flat fields so the LLM doesn't need to construct nested objects
        const payload: Record<string, unknown> = { title: args.title };
        if (args.startDateTime) payload.startDateTime = args.startDateTime;
        if (args.endDateTime) payload.endDateTime = args.endDateTime;
        if (args.location) payload.location = args.location;
        if (args.dueAt) payload.dueAt = args.dueAt;
        if (args.itemName) payload.name = args.itemName;
        else if (args.type === "SHOPPING_ITEM") payload.name = args.title;
        if (args.quantity) payload.quantity = args.quantity;
        if (args.unit) payload.unit = args.unit;
        if (args.memberId) payload.memberId = args.memberId;
        if (args.participantIds && args.participantIds.length > 0)
          payload.participantIds = args.participantIds;
        return JSON.stringify(
          await createProposalTool(
            {
              type: args.type as ProposalType,
              title: args.title,
              description: args.description,
              payload: payload as unknown as Prisma.InputJsonObject,
              source: args.source,
              confidence: args.confidence,
              memberId: args.memberId,
              notes: args.notes,
              sourceFileUrl: args.sourceFileUrl,
            },
            ctx,
          ),
        );
      },
    }),

    new DynamicStructuredTool({
      name: "list_pending_proposals",
      description:
        "Lista las propuestas pendientes de revisión del hogar. Usá esto cuando el usuario pregunte qué hay pendiente de revisar o aprobar.",
      schema: z.object({
        memberId: z.string().optional().describe("Filtrar por miembro (opcional)"),
        type: z
          .enum(["EVENT", "REMINDER", "SHOPPING_ITEM", "DOCUMENT", "OTHER"])
          .optional()
          .describe("Filtrar por tipo de propuesta (opcional)"),
      }),
      func: async (args) =>
        noHousehold
          ? NO_HOUSEHOLD
          : JSON.stringify(
              await listPendingProposalsTool(
                { ...args, type: args.type as ProposalType | undefined },
                ctx,
              ),
            ),
    }),

    new DynamicStructuredTool({
      name: "approve_proposal",
      description:
        "Aprueba una propuesta pendiente y crea la entidad correspondiente (evento, recordatorio, item de compra). Usá esto cuando el usuario diga 'aprobar', 'ok', 'dale', 'confirmá' o similar sobre una propuesta específica.",
      schema: z.object({
        proposalId: z.string().describe("ID de la propuesta a aprobar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await approveProposalTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "reject_proposal",
      description:
        "Rechaza una propuesta pendiente sin crear ninguna entidad. Usá esto cuando el usuario diga 'rechazar', 'no', 'cancelar' o similar sobre una propuesta específica.",
      schema: z.object({
        proposalId: z.string().describe("ID de la propuesta a rechazar"),
        reason: z.string().optional().describe("Motivo del rechazo (opcional)"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await rejectProposalTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "find_family_member",
      description:
        "Busca un integrante de la familia por nombre o apodo y devuelve su ID. Usá esto cuando el usuario mencione 'es de [nombre]', 'para [nombre]', 'de pauli', etc. para obtener el memberId antes de crear o aprobar una propuesta.",
      schema: z.object({
        nameQuery: z.string().describe("Nombre o apodo del integrante a buscar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await findFamilyMemberTool(args, ctx)),
    }),
  ];
}

/**
 * Builds and returns the compiled Inbox subagent graph.
 * Handles external source ingestion: images, PDFs, emails, web pages.
 * Produces structured candidates (EventCandidate, ProductIntentItem, etc.) for other agents.
 */
export async function buildInboxAgent(
  allTools: StructuredToolInterface[],
  householdId: string | null,
  cfg?: AgentConfigOptions,
  _caller?: CallerInfo,
) {
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  const resolvedId = await resolveHouseholdId(householdId ?? undefined);

  const mcpTools = filterInboxTools(allTools);
  const inboxTools = [...buildInboxTools(resolvedId), ...mcpTools];

  return new AgentBuilder({
    llm,
    tools: inboxTools,
    prompt: INBOX_AGENT_PROMPT(),
    checkpointer: postgresCheckpointer,
    approveAllTools: true,
  }).build();
}
