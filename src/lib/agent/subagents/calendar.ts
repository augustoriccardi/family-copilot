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
import { CALENDAR_AGENT_PROMPT } from "../prompts/calendar";
import { CallerInfo } from "../prompts/supervisor";
import {
  resolveHouseholdId,
  findFamilyMemberTool,
  getFamilyContextTool,
} from "../../tools/family/index";
import {
  createCalendarEventTool,
  listCalendarEventsTool,
  updateCalendarEventTool,
  deleteCalendarEventTool,
  findFreeSlotsTool,
  checkConflictsTool,
} from "../../tools/calendar/index";
import prisma from "../../database/prisma";

/** MCP server name prefixes that belong to the calendar domain */
const CALENDAR_TOOL_PREFIXES = ["google-calendar", "google_calendar", "calendar"];

/**
 * Filters tools to only those relevant to the calendar domain.
 */
export function filterCalendarTools(allTools: StructuredToolInterface[]): DynamicTool[] {
  return allTools.filter((tool) =>
    CALENDAR_TOOL_PREFIXES.some((prefix) => tool.name.toLowerCase().startsWith(prefix)),
  ) as DynamicTool[];
}

const NO_HOUSEHOLD = JSON.stringify({
  error:
    "No hay hogar configurado. Para usar funciones familiares, primero creá un hogar desde la interfaz web.",
});

/**
 * Builds the Prisma-backed calendar tools scoped to the household.
 * These tools write/read from the app DB (source of truth) independently of Google Calendar.
 */
function buildPrismaCalendarTools(householdId: string | null, callerId?: string) {
  const noHousehold = !householdId;
  const ctx = { householdId: householdId ?? "", callerId };

  return [
    new DynamicStructuredTool({
      name: "get_family_context",
      description:
        "Obtiene la lista completa de integrantes del hogar con sus IDs, roles y datos. Usá esto cuando el usuario diga 'todos', 'toda la familia', 'nosotros', 'menos [alguien]', o cuando no quede claro quiénes son los participantes.",
      schema: z.object({}),
      func: async () =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await getFamilyContextTool(ctx)),
    }),

    new DynamicStructuredTool({
      name: "find_family_member",
      description:
        "Busca un integrante de la familia por nombre o apodo. Usá esto antes de crear un evento para obtener el memberId real.",
      schema: z.object({
        nameQuery: z.string().describe("Nombre o apodo del integrante a buscar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await findFamilyMemberTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "check_conflicts",
      description:
        "Detecta eventos que se solapan con un rango propuesto para CUALQUIERA de los participantes indicados. Llamá esto ANTES de crear un evento. Pasá todos los IDs involucrados (beneficiario + responsable + invitados).",
      schema: z.object({
        startDateTime: z.string().describe("Inicio del rango propuesto en ISO 8601"),
        endDateTime: z.string().describe("Fin del rango propuesto en ISO 8601"),
        participantIds: z
          .array(z.string())
          .optional()
          .describe(
            "IDs de todos los integrantes a chequear (beneficiario, responsable, invitados)",
          ),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await checkConflictsTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "create_family_event",
      description:
        "Crea un evento en el calendario familiar. El sync con Google Calendar ocurre automáticamente si el memberId tiene un MemberCalendar configurado.",
      schema: z.object({
        title: z.string().describe("Título del evento"),
        description: z.string().optional(),
        startDateTime: z.string().describe("Fecha y hora de inicio en ISO 8601"),
        endDateTime: z.string().describe("Fecha y hora de fin en ISO 8601"),
        allDay: z.boolean().optional().describe("true si el evento es todo el día"),
        location: z.string().optional(),
        eventType: z
          .enum(["FAMILY", "PERSONAL", "MEDICAL", "SCHOOL", "ACTIVITY", "WORK", "OTHER"])
          .optional()
          .describe("Tipo de evento"),
        memberId: z
          .string()
          .optional()
          .describe("ID del beneficiario principal (obtenido de find_family_member)"),
        responsibleMemberId: z
          .string()
          .optional()
          .describe("ID de quien lleva/acompaña (obtenido de find_family_member)"),
        createdByMemberId: z
          .string()
          .optional()
          .describe("ID de quien está creando el evento desde la app"),
        participantIds: z
          .array(z.string())
          .optional()
          .describe(
            "IDs de quienes asistirán al evento según lo que dijo el usuario. NO agregues a toda la familia por defecto — solo quienes fueron mencionados explícitamente como asistentes. Para un evento personal de una sola persona, incluí solo esa persona.",
          ),
        memberCalendarId: z
          .string()
          .nullish()
          .describe(
            "ID del MemberCalendar donde sincronizar externamente. Omitir o null = auto-resolver. Usá get_member_calendars para obtener opciones.",
          ),
        notes: z.string().optional(),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await createCalendarEventTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "list_family_events",
      description: "Lista los eventos del calendario familiar en un rango de fechas.",
      schema: z.object({
        startDate: z.string().describe("Fecha inicio en ISO 8601"),
        endDate: z.string().describe("Fecha fin en ISO 8601"),
        memberId: z.string().optional().describe("Filtrar por integrante específico"),
        includeAsParticipant: z
          .boolean()
          .optional()
          .describe(
            "Si true, incluye también eventos donde el miembro es participante (no solo beneficiario)",
          ),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await listCalendarEventsTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "update_family_event",
      description:
        "Actualiza un evento existente. El sync con Google Calendar ocurre automáticamente.",
      schema: z.object({
        eventId: z.string().describe("ID del evento a actualizar"),
        title: z.string().optional(),
        startDateTime: z.string().optional().describe("Nueva fecha/hora de inicio en ISO 8601"),
        endDateTime: z.string().optional().describe("Nueva fecha/hora de fin en ISO 8601"),
        location: z.string().optional(),
        notes: z.string().optional(),
        status: z
          .enum(["CONFIRMED", "TENTATIVE", "CANCELLED"])
          .optional()
          .describe("Nuevo estado del evento"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await updateCalendarEventTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "delete_family_event",
      description: "Elimina un evento. El sync con Google Calendar ocurre automáticamente.",
      schema: z.object({
        eventId: z.string().describe("ID del evento a eliminar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await deleteCalendarEventTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "find_free_slots",
      description:
        "Busca huecos libres donde TODOS los participantes indicados estén disponibles simultáneamente.",
      schema: z.object({
        startDate: z.string().describe("Inicio del rango de búsqueda en ISO 8601"),
        endDate: z.string().describe("Fin del rango de búsqueda en ISO 8601"),
        durationMinutes: z.number().describe("Duración del evento en minutos"),
        participantIds: z
          .array(z.string())
          .optional()
          .describe("IDs de todos los participantes que deben estar libres"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await findFreeSlotsTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "get_member_calendars",
      description:
        "Obtiene los calendarios externos configurados de un integrante (personal, familiar compartido, etc.). Usá esto para saber a qué memberCalendarId sincronizar un nuevo evento.",
      schema: z.object({
        memberId: z.string().describe("ID del integrante"),
      }),
      func: async ({ memberId }) => {
        if (noHousehold) return NO_HOUSEHOLD;

        // Validate the memberId — if it doesn't exist, fall back to callerId
        const memberExists = await prisma.familyMember.findUnique({
          where: { id: memberId },
          select: { id: true },
        });
        const resolvedMemberId = memberExists ? memberId : (callerId ?? memberId);

        const calendars = await prisma.memberCalendar.findMany({
          where: { householdMemberId: resolvedMemberId },
          select: {
            id: true,
            type: true,
            googleCalendarId: true,
            displayName: true,
            isPrimary: true,
          },
        });
        if (calendars.length === 0)
          return JSON.stringify({
            memberId: resolvedMemberId,
            calendars: [],
            message:
              "Este integrante no tiene calendarios externos configurados. El evento se guardará solo en la app.",
          });
        return JSON.stringify({ memberId: resolvedMemberId, calendars });
      },
    }),
  ];
}

/**
 * Builds and returns the compiled Calendar subagent graph.
 * Combines MCP Google Calendar tools (if available) with Prisma-backed household tools.
 * The DB is the source of truth; Google Calendar is a sync layer.
 */
export async function buildCalendarAgent(
  allTools: StructuredToolInterface[],
  householdId?: string,
  cfg?: AgentConfigOptions,
) {
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  const resolvedId = await resolveHouseholdId(householdId);

  const caller: CallerInfo = {
    callerId: cfg?.callerId,
    callerName: cfg?.callerName,
    callerRole: cfg?.callerRole,
  };

  // MCP tools (Google Calendar) + Prisma tools (DB) combined
  const mcpTools = filterCalendarTools(allTools);
  const prismaTools = buildPrismaCalendarTools(resolvedId, cfg?.callerId);

  return new AgentBuilder({
    llm,
    tools: [...prismaTools, ...mcpTools],
    prompt: CALENDAR_AGENT_PROMPT(caller),
    checkpointer: postgresCheckpointer,
    approveAllTools: true, // Subagents always auto-approve — interrupt flow breaks in nested graphs
  }).build();
}
