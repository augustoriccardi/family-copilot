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
  upsertConstraintTool,
  deleteConstraintTool,
  listConstraintsTool,
  addFamilyMemberTool,
  updateFamilyMemberTool,
  updateHouseholdPreferencesTool,
  deletePantryItemTool,
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

    new DynamicStructuredTool({
      name: "delete_pantry_item",
      description: "Elimina un producto de la despensa por nombre.",
      schema: z.object({
        itemName: z.string().describe("Nombre del producto a eliminar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await deletePantryItemTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "list_constraints",
      description:
        "Lista las restricciones de un integrante o de toda la familia: alergias, dietas, medicamentos, reglas de horario, etc.",
      schema: z.object({
        memberId: z.string().optional().describe("ID del integrante. Omitir = toda la familia"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await listConstraintsTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "upsert_constraint",
      description:
        "Guarda o actualiza una restricción de un integrante (alergia, intolerancia, medicamento, dieta, regla de horario, etc.). Usá esta tool cuando alguien mencione que es alérgico, intolerante, toma un medicamento, sigue una dieta especial o tiene una regla de horario fija.",
      schema: z.object({
        memberId: z
          .string()
          .nullish()
          .describe("ID del integrante afectado. null = restricción del hogar entero"),
        type: z
          .enum(["ALLERGY", "DISLIKE", "MEDICATION", "SCHEDULE_RULE", "DIET", "OTHER"])
          .describe(
            "Tipo: ALLERGY=alergia, DISLIKE=no le gusta, MEDICATION=medicamento, SCHEDULE_RULE=regla de horario, DIET=dieta, OTHER=otro",
          ),
        key: z
          .string()
          .describe(
            "Identificador corto de la restricción, ej: 'mani', 'lactosa', 'aspirina', 'no_lunes_noche'",
          ),
        value: z
          .string()
          .describe(
            "Descripción completa, ej: 'Alérgico al maní — riesgo anafilaxis', 'Toma 10mg de Ritalin por la mañana'",
          ),
      }),
      func: async (args) =>
        noHousehold
          ? NO_HOUSEHOLD
          : JSON.stringify(
              await upsertConstraintTool({ ...args, memberId: args.memberId ?? undefined }, ctx),
            ),
    }),

    new DynamicStructuredTool({
      name: "delete_constraint",
      description:
        "Elimina una restricción existente (cuando ya no aplica). Usá list_constraints primero para obtener el ID.",
      schema: z.object({
        constraintId: z.string().describe("ID de la restricción a eliminar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await deleteConstraintTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "add_family_member",
      description: "Agrega un nuevo integrante al hogar familiar.",
      schema: z.object({
        name: z.string().describe("Nombre completo"),
        role: z
          .enum(["MADRE", "PADRE", "HIJO", "HIJA", "ABUELO", "ABUELA", "OTRO"])
          .describe("Rol en la familia"),
        nickname: z.string().optional(),
        birthdate: z.string().optional().describe("Fecha de nacimiento en formato ISO 8601"),
        schoolName: z.string().optional().describe("Nombre del colegio/escuela si aplica"),
        isMinor: z.boolean().optional().describe("true si es menor de edad"),
        notes: z.string().optional(),
        color: z.string().optional().describe("Color identificador en hex, ej: '#FF6B6B'"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await addFamilyMemberTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "update_family_member",
      description: "Actualiza datos de un integrante existente (apodo, notas, colegio, etc.).",
      schema: z.object({
        memberId: z.string().describe("ID del integrante a actualizar"),
        name: z.string().optional(),
        nickname: z.string().optional(),
        birthdate: z.string().optional().describe("ISO 8601"),
        schoolName: z.string().optional(),
        notes: z.string().optional(),
        color: z.string().optional().describe("Color hex, ej: '#FF6B6B'"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await updateFamilyMemberTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "update_household_preferences",
      description:
        "Actualiza las preferencias del hogar: supermercado preferido, presupuesto semanal, día de compras, estilo de comida.",
      schema: z.object({
        preferredSupermarket: z.string().optional(),
        weeklyBudget: z.number().optional().describe("Presupuesto semanal en la moneda del hogar"),
        shoppingDay: z.string().optional().describe("Día de la semana para hacer las compras"),
        mealStyle: z
          .string()
          .optional()
          .describe("Estilo de comida preferido, ej: 'mediterráneo', 'vegano'"),
      }),
      func: async (args) =>
        noHousehold
          ? NO_HOUSEHOLD
          : JSON.stringify(await updateHouseholdPreferencesTool(args, ctx)),
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
  const llm = createChatModel({
    provider,
    model: modelName,
    temperature: 0.3,
    apiKey: cfg?.apiKey,
  });

  const caller = cfg?.callerName
    ? { callerId: cfg.callerId, callerName: cfg.callerName, callerRole: cfg.callerRole }
    : undefined;

  return new AgentBuilder({
    llm,
    tools: buildFamilyTools(resolvedId),
    prompt: FAMILY_AGENT_PROMPT(caller),
    checkpointer: postgresCheckpointer,
    approveAllTools: true, // Subagents always auto-approve — interrupt flow breaks in nested graphs
  }).build();
}
