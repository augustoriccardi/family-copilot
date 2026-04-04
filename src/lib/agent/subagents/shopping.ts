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
  removeItemsFromListTool,
  deleteShoppingListTool,
  addProductIntentItemsTool,
} from "../../tools/shopping/index";
import { createReminderTool } from "../../tools/reminders/index";
import { markListPurchasedAndUpdatePantryTool } from "../../tools/shopping/pantry-handoff";

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

    new DynamicStructuredTool({
      name: "remove_items_from_list",
      description: "Elimina ítems específicos de una lista de compras.",
      schema: z.object({
        listId: z.string().describe("ID de la lista de compras"),
        itemIds: z.array(z.string()).describe("IDs de los ítems a eliminar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await removeItemsFromListTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "delete_shopping_list",
      description: "Elimina una lista de compras completa y todos sus ítems.",
      schema: z.object({
        listId: z.string().describe("ID de la lista a eliminar"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await deleteShoppingListTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "add_product_intent_items",
      description:
        "Agrega ProductIntentItem[] a la lista de compras activa (o crea una nueva si no hay). Punto de entrada para el handoff recipe→shopping. Los ítems vienen pre-normalizados desde recipe, inbox o family.",
      schema: z.object({
        items: z
          .array(
            z.object({
              canonicalName: z.string(),
              quantity: z.number().optional(),
              unit: z.string().optional(),
              category: z.string().optional(),
              notes: z.string().optional(),
            }),
          )
          .describe("Lista estructurada de productos a agregar"),
        listId: z
          .string()
          .optional()
          .describe(
            "ID de lista destino (opcional — si se omite, usa la lista activa o crea una nueva)",
          ),
        source: z
          .enum(["recipe", "inbox", "family", "manual"])
          .optional()
          .describe("Origen de los ítems para trazabilidad"),
        sourceLabel: z.string().optional().describe("Nombre del origen (ej: nombre de la receta)"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await addProductIntentItemsTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "create_shopping_reminder",
      description:
        "Crea un recordatorio de 'ir de compras' con la lista activa en el cuerpo. El usuario recibirá la nota cuando llegue la fecha. Ideal cuando el usuario dice 'recordame ir al super' o 'agendame la compra para el sábado'.",
      schema: z.object({
        dueAt: z
          .string()
          .describe("Fecha y hora ISO 8601 para el recordatorio, ej: '2026-04-05T10:00:00'"),
        memberId: z.string().optional().describe("ID del miembro responsable (opcional)"),
        customTitle: z
          .string()
          .optional()
          .describe("Título personalizado (por defecto: 'Ir de compras')"),
      }),
      func: async (args) => {
        if (noHousehold) return NO_HOUSEHOLD;
        // Get the active list to embed in the reminder description
        const list = await getActiveShoppingListTool(ctx);
        const items = Array.isArray(list?.items)
          ? list.items
              .map(
                (i: { itemName: string; quantity?: number; unit?: string }) =>
                  `• ${i.itemName}${i.quantity ? ` (${i.quantity}${i.unit ? " " + i.unit : ""})` : ""}`,
              )
              .join("\n")
          : "";
        return JSON.stringify(
          await createReminderTool(
            {
              title: args.customTitle ?? "Ir de compras",
              description: items ? `Lista de compras:\n${items}` : undefined,
              dueAt: args.dueAt,
              memberId: args.memberId,
            },
            ctx,
          ),
        );
      },
    }),

    new DynamicStructuredTool({
      name: "mark_list_purchased",
      description:
        "Marca la lista de compras como comprada y actualiza el stock de la despensa con todos los ítems de la lista. Usá esto cuando el usuario confirme que ya hizo las compras: 'ya fui al super', 'compré todo', 'listo la compra'.",
      schema: z.object({
        listId: z.string().optional().describe("ID de la lista (si se omite, usa la activa)"),
      }),
      func: async (args) =>
        noHousehold
          ? NO_HOUSEHOLD
          : JSON.stringify(await markListPurchasedAndUpdatePantryTool(args, ctx)),
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
    approveAllTools: true, // Subagents always auto-approve — interrupt flow breaks in nested graphs
  }).build();
}
