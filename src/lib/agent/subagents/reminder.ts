import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentBuilder } from "../builder";
import { postgresCheckpointer } from "../memory";
import {
  AgentConfigOptions,
  createChatModel,
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
} from "../util";
import { REMINDER_AGENT_PROMPT } from "../prompts/reminder";
import { resolveHouseholdId } from "../../tools/family/index";
import {
  createReminderTool,
  listRemindersTool,
  completeReminderTool,
  dismissReminderTool,
} from "../../tools/reminders/index";

const NO_HOUSEHOLD = JSON.stringify({
  error:
    "No hay hogar configurado. Para usar funciones familiares, primero creá un hogar desde la interfaz web.",
});

function buildReminderTools(householdId: string | null) {
  const noHousehold = !householdId;
  const ctx = { householdId: householdId ?? "" };

  return [
    new DynamicStructuredTool({
      name: "create_reminder",
      description: "Crea un recordatorio para un integrante del hogar o para toda la familia.",
      schema: z.object({
        title: z.string().describe("Título del recordatorio"),
        description: z.string().optional().describe("Descripción adicional"),
        dueAt: z.string().describe("Fecha y hora de vencimiento en formato ISO 8601"),
        memberId: z.string().optional().describe("ID del integrante al que aplica (opcional)"),
        recurrenceRule: z
          .string()
          .optional()
          .describe("Regla de recurrencia en formato iCal RRULE, ej: FREQ=WEEKLY;BYDAY=MO"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await createReminderTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "list_reminders",
      description:
        "Lista los recordatorios pendientes del hogar, opcionalmente filtrados por fechas o integrante.",
      schema: z.object({
        startDate: z.string().optional().describe("Fecha inicio en ISO 8601"),
        endDate: z.string().optional().describe("Fecha fin en ISO 8601"),
        memberId: z.string().optional().describe("Filtrar por integrante"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await listRemindersTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "complete_reminder",
      description: "Marca un recordatorio como completado.",
      schema: z.object({
        reminderId: z.string().describe("ID del recordatorio a completar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await completeReminderTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "dismiss_reminder",
      description: "Descarta un recordatorio sin marcarlo como completado.",
      schema: z.object({
        reminderId: z.string().describe("ID del recordatorio a descartar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await dismissReminderTool(args, ctx)),
    }),
  ];
}

export async function buildReminderAgent(householdId?: string, cfg?: AgentConfigOptions) {
  const resolvedId = await resolveHouseholdId(householdId);
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  return new AgentBuilder({
    llm,
    tools: buildReminderTools(resolvedId),
    prompt: REMINDER_AGENT_PROMPT(),
    checkpointer: postgresCheckpointer,
    approveAllTools: true, // Subagents always auto-approve — interrupt flow breaks in nested graphs
  }).build();
}
