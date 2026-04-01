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
import { FAMILY_AGENT_PROMPT } from "../prompts/family";
import {
  resolveHouseholdId,
  getFamilyContextTool,
  findFamilyMemberTool,
  getMemberScheduleRulesTool,
  getPantryItemsTool,
  updatePantryTool,
} from "../../tools/family/index";

function buildFamilyTools(householdId: string | null) {
  const noHousehold = !householdId;
  const ctx = { householdId: householdId ?? "" };

  return [
    new DynamicStructuredTool({
      name: "get_family_context",
      description:
        "Obtiene el contexto completo del hogar: integrantes, preferencias y restricciones.",
      schema: z.object({}),
      func: async () =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await getFamilyContextTool(ctx)),
    }),

    new DynamicStructuredTool({
      name: "find_family_member",
      description: "Busca un integrante de la familia por nombre o apodo.",
      schema: z.object({
        nameQuery: z.string().describe("Nombre o apodo del integrante"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await findFamilyMemberTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "get_member_schedule_rules",
      description: "Devuelve las reglas de horario y compromisos recurrentes de un integrante.",
      schema: z.object({
        memberId: z.string().describe("ID del integrante de la familia"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await getMemberScheduleRulesTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "get_pantry_items",
      description: "Lista el inventario actual de la despensa del hogar.",
      schema: z.object({}),
      func: async () =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await getPantryItemsTool(ctx)),
    }),

    new DynamicStructuredTool({
      name: "update_pantry",
      description: "Actualiza el inventario de la despensa (agrega o modifica productos).",
      schema: z.object({
        items: z
          .array(
            z.object({
              itemName: z.string(),
              quantity: z.number().optional(),
              unit: z.string().optional(),
              category: z.string().optional(),
              expirationDate: z.string().optional().describe("ISO 8601 date string"),
            }),
          )
          .describe("Lista de items a actualizar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await updatePantryTool(args, ctx)),
    }),
  ];
}

const NO_HOUSEHOLD = JSON.stringify({
  error:
    "No hay hogar configurado. Para usar funciones familiares, primero creá un hogar desde la interfaz web.",
});

export async function buildFamilyAgent(householdId?: string, cfg?: AgentConfigOptions) {
  const resolvedId = await resolveHouseholdId(householdId);
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  return new AgentBuilder({
    llm,
    tools: buildFamilyTools(resolvedId),
    prompt: FAMILY_AGENT_PROMPT(),
    checkpointer: postgresCheckpointer,
    approveAllTools: cfg?.approveAllTools ?? false,
  }).build();
}
