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
import { RECIPE_AGENT_PROMPT } from "../prompts/recipe";
import { resolveHouseholdId, getPantryItemsTool } from "../../tools/family/index";
import { saveRecipeTool, searchRecipesTool } from "../../tools/recipes/index";

const ingredientSchema = z.object({
  name: z.string(),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  optional: z.boolean().optional(),
  category: z.string().optional(),
});

const NO_HOUSEHOLD = JSON.stringify({
  error:
    "No hay hogar configurado. Para usar funciones familiares, primero creá un hogar desde la interfaz web.",
});

function buildRecipeTools(householdId: string | null) {
  const noHousehold = !householdId;
  const ctx = { householdId: householdId ?? "" };

  return [
    new DynamicStructuredTool({
      name: "save_recipe",
      description: "Guarda una receta en la base de datos familiar con sus ingredientes.",
      schema: z.object({
        title: z.string().describe("Nombre de la receta"),
        description: z.string().optional(),
        servings: z.number().optional().describe("Cantidad de porciones"),
        prepTimeMinutes: z.number().optional().describe("Tiempo de preparación en minutos"),
        cookTimeMinutes: z.number().optional().describe("Tiempo de cocción en minutos"),
        tags: z.array(z.string()).optional().describe("Etiquetas como 'vegano', 'rápido', etc."),
        instructions: z.string().optional().describe("Paso a paso de la preparación"),
        sourceType: z
          .enum(["AUDIO", "IMAGE", "TEXT", "LINK", "MANUAL"])
          .describe("Origen de la receta"),
        sourceUrl: z.string().optional(),
        imageUrl: z.string().optional(),
        ingredients: z.array(ingredientSchema).describe("Lista de ingredientes"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await saveRecipeTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "search_recipes",
      description: "Busca recetas guardadas por nombre, tags o tiempo de preparación.",
      schema: z.object({
        query: z.string().optional().describe("Búsqueda por nombre o descripción"),
        tags: z.array(z.string()).optional().describe("Filtrar por etiquetas"),
        maxPrepTimeMinutes: z
          .number()
          .optional()
          .describe("Tiempo máximo de preparación en minutos"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await searchRecipesTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "get_pantry_items",
      description: "Lista el inventario actual de la despensa para sugerir recetas con lo que hay.",
      schema: z.object({}),
      func: async () =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await getPantryItemsTool(ctx)),
    }),
  ];
}

export async function buildRecipeAgent(householdId?: string, cfg?: AgentConfigOptions) {
  const resolvedId = await resolveHouseholdId(householdId);
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  return new AgentBuilder({
    llm,
    tools: buildRecipeTools(resolvedId),
    prompt: RECIPE_AGENT_PROMPT(),
    checkpointer: postgresCheckpointer,
    approveAllTools: true, // Subagents always auto-approve — interrupt flow breaks in nested graphs
  }).build();
}
