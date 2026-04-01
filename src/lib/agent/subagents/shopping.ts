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
import { SHOPPING_AGENT_PROMPT } from "../prompts/shopping";
import { resolveHouseholdId } from "../../tools/family/index";
import {
  createShoppingListTool,
  addItemsToShoppingListTool,
  generateGroceryListFromRecipesTool,
  getActiveShoppingListTool,
  markItemsPurchasedTool,
} from "../../tools/shopping/index";

const shoppingItemSchema = z.object({
  itemName: z.string(),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
});

const NO_HOUSEHOLD = JSON.stringify({
  error:
    "No hay hogar configurado. Para usar funciones familiares, primero creá un hogar desde la interfaz web.",
});

function buildShoppingTools(householdId: string | null) {
  const noHousehold = !householdId;
  const ctx = { householdId: householdId ?? "" };

  return [
    new DynamicStructuredTool({
      name: "get_active_shopping_list",
      description: "Devuelve la lista de compras activa del hogar, agrupada por categoría.",
      schema: z.object({}),
      func: async () =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await getActiveShoppingListTool(ctx)),
    }),

    new DynamicStructuredTool({
      name: "create_shopping_list",
      description: "Crea una nueva lista de compras con ítems opcionales.",
      schema: z.object({
        name: z.string().describe("Nombre de la lista, ej: 'Compras del martes'"),
        sourceType: z
          .enum(["MANUAL", "MEAL_PLAN", "RECIPE", "AUTO"])
          .optional()
          .describe("Origen de la lista"),
        items: z.array(shoppingItemSchema).optional(),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await createShoppingListTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "add_items_to_shopping_list",
      description: "Agrega ítems a una lista de compras existente.",
      schema: z.object({
        listId: z.string().describe("ID de la lista de compras"),
        items: z.array(shoppingItemSchema),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await addItemsToShoppingListTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "generate_grocery_list_from_recipes",
      description:
        "Genera una lista de compras a partir de recetas, descontando automáticamente lo que hay en la despensa.",
      schema: z.object({
        recipeIds: z.array(z.string()).describe("IDs de las recetas a planificar"),
        listName: z.string().optional().describe("Nombre opcional para la lista"),
      }),
      func: async (args) =>
        noHousehold
          ? NO_HOUSEHOLD
          : JSON.stringify(await generateGroceryListFromRecipesTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "mark_items_purchased",
      description: "Marca ítems de la lista como comprados.",
      schema: z.object({
        listId: z.string().describe("ID de la lista de compras"),
        itemIds: z.array(z.string()).describe("IDs de los ítems marcados como comprados"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await markItemsPurchasedTool(args, ctx)),
    }),
  ];
}

export async function buildShoppingAgent(householdId?: string, cfg?: AgentConfigOptions) {
  const resolvedId = await resolveHouseholdId(householdId);
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  return new AgentBuilder({
    llm,
    tools: buildShoppingTools(resolvedId),
    prompt: SHOPPING_AGENT_PROMPT(),
    checkpointer: postgresCheckpointer,
    approveAllTools: cfg?.approveAllTools ?? false,
  }).build();
}
