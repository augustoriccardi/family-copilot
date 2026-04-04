import prisma from "@/lib/database/prisma";
import type { AgentContext } from "../family/index";

export async function createShoppingListTool(
  args: {
    name: string;
    sourceType?: "MANUAL" | "MEAL_PLAN" | "RECIPE" | "AUTO";
    items?: Array<{
      itemName: string;
      quantity?: number;
      unit?: string;
      category?: string;
      notes?: string;
    }>;
  },
  ctx: AgentContext,
) {
  const list = await prisma.shoppingList.create({
    data: {
      householdId: ctx.householdId,
      name: args.name,
      sourceType: args.sourceType ?? "MANUAL",
      status: "DRAFT",
      items: args.items
        ? {
            create: args.items.map((item) => ({
              itemName: item.itemName,
              quantity: item.quantity,
              unit: item.unit,
              category: item.category,
              notes: item.notes,
            })),
          }
        : undefined,
    },
    include: { items: true },
  });

  return {
    listId: list.id,
    name: list.name,
    status: list.status,
    itemCount: list.items.length,
  };
}

export async function addItemsToShoppingListTool(
  args: {
    listId: string;
    items: Array<{
      itemName: string;
      quantity?: number;
      unit?: string;
      category?: string;
      notes?: string;
    }>;
  },
  ctx: AgentContext,
) {
  const list = await prisma.shoppingList.findFirst({
    where: { id: args.listId, householdId: ctx.householdId },
  });
  if (!list) throw new Error("Lista no encontrada");

  const created = await prisma.shoppingListItem.createMany({
    data: args.items.map((item) => ({
      shoppingListId: args.listId,
      itemName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      category: item.category,
      notes: item.notes,
    })),
  });

  return { listId: args.listId, itemsAdded: created.count };
}

export async function generateGroceryListFromRecipesTool(
  args: {
    recipeIds: string[];
    listName?: string;
  },
  ctx: AgentContext,
) {
  const ingredients = await prisma.recipeIngredient.findMany({
    where: { recipeId: { in: args.recipeIds } },
    include: { recipe: { select: { title: true, id: true } } },
  });

  // Consolidate by ingredient name
  const consolidated = new Map<
    string,
    { quantity: number; unit: string; category: string; sourceRecipeId: string }
  >();

  for (const ing of ingredients) {
    const key = ing.ingredientName.toLowerCase().trim();
    const existing = consolidated.get(key);
    const qty = Number(ing.quantity ?? 0);
    if (existing) {
      existing.quantity += qty;
    } else {
      consolidated.set(key, {
        quantity: qty,
        unit: ing.unit ?? "",
        category: ing.category ?? "Otros",
        sourceRecipeId: ing.recipe.id,
      });
    }
  }

  // Subtract pantry
  const pantryItems = await prisma.pantryItem.findMany({
    where: { householdId: ctx.householdId },
  });
  const pantryMap = new Map(
    pantryItems.map((p) => [p.itemName.toLowerCase().trim(), Number(p.quantity ?? 0)]),
  );

  const needed = [];
  for (const [name, data] of consolidated) {
    const inPantry = pantryMap.get(name) ?? 0;
    const remaining = data.quantity - inPantry;
    if (remaining > 0) {
      needed.push({ itemName: name, quantity: remaining, ...data });
    }
  }

  const list = await prisma.shoppingList.create({
    data: {
      householdId: ctx.householdId,
      name: args.listName ?? `Compras — ${args.recipeIds.length} recetas`,
      sourceType: "RECIPE",
      status: "DRAFT",
      items: { create: needed },
    },
    include: { items: true },
  });

  const byCategory = new Map<string, string[]>();
  for (const item of list.items) {
    const cat = item.category ?? "Otros";
    const arr = byCategory.get(cat) ?? [];
    arr.push(`${item.itemName} (${item.quantity ?? ""} ${item.unit ?? ""})`);
    byCategory.set(cat, arr);
  }

  return {
    listId: list.id,
    name: list.name,
    totalItems: list.items.length,
    byCategory: Object.fromEntries(byCategory),
  };
}

export async function getActiveShoppingListTool(ctx: AgentContext) {
  const list = await prisma.shoppingList.findFirst({
    where: {
      householdId: ctx.householdId,
      status: { in: ["DRAFT", "ACTIVE"] },
    },
    include: { items: { orderBy: { category: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  if (!list) return { message: "No hay lista de compras activa." };

  const byCategory = new Map<
    string,
    Array<{ name: string; quantity: string; purchased: boolean }>
  >();
  for (const item of list.items) {
    const cat = item.category ?? "Otros";
    const arr = byCategory.get(cat) ?? [];
    arr.push({
      name: item.itemName,
      quantity: `${item.quantity ?? ""} ${item.unit ?? ""}`.trim(),
      purchased: item.isPurchased,
    });
    byCategory.set(cat, arr);
  }

  return {
    listId: list.id,
    name: list.name,
    status: list.status,
    byCategory: Object.fromEntries(byCategory),
    totalItems: list.items.length,
    purchasedItems: list.items.filter((i) => i.isPurchased).length,
  };
}

export async function markItemsPurchasedTool(
  args: { listId: string; itemIds: string[] },
  ctx: AgentContext,
) {
  const list = await prisma.shoppingList.findFirst({
    where: { id: args.listId, householdId: ctx.householdId },
  });
  if (!list) throw new Error("Lista no encontrada");

  const result = await prisma.shoppingListItem.updateMany({
    where: { id: { in: args.itemIds }, shoppingListId: args.listId },
    data: { isPurchased: true },
  });

  return { marked: result.count };
}

export async function removeItemsFromListTool(
  args: { listId: string; itemIds: string[] },
  ctx: AgentContext,
) {
  const list = await prisma.shoppingList.findFirst({
    where: { id: args.listId, householdId: ctx.householdId },
  });
  if (!list) throw new Error("Lista no encontrada");

  const result = await prisma.shoppingListItem.deleteMany({
    where: { id: { in: args.itemIds }, shoppingListId: args.listId },
  });

  return { removed: result.count };
}

export async function deleteShoppingListTool(args: { listId: string }, ctx: AgentContext) {
  const list = await prisma.shoppingList.findFirst({
    where: { id: args.listId, householdId: ctx.householdId },
  });
  if (!list) throw new Error("Lista no encontrada");

  await prisma.shoppingList.delete({ where: { id: args.listId } });
  return { deleted: true, listId: args.listId };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD PRODUCT INTENT ITEMS (recipe/inbox → shopping handoff)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Receives ProductIntentItem[] from recipe or inbox and adds them to the active shopping list.
 * Creates a new list if no active list exists.
 */
export async function addProductIntentItemsTool(
  args: {
    items: Array<{
      canonicalName: string;
      quantity?: number;
      unit?: string;
      category?: string;
      notes?: string;
    }>;
    /** Optional: target an existing list. If omitted, uses or creates the active list. */
    listId?: string;
    /** Source for traceability */
    source?: "recipe" | "inbox" | "family" | "manual";
    sourceLabel?: string;
  },
  ctx: AgentContext,
) {
  let targetListId = args.listId;

  if (!targetListId) {
    const active = await prisma.shoppingList.findFirst({
      where: { householdId: ctx.householdId, status: { in: ["DRAFT", "ACTIVE"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (active) {
      targetListId = active.id;
    } else {
      const newList = await prisma.shoppingList.create({
        data: {
          householdId: ctx.householdId,
          name: args.sourceLabel
            ? `Compras — ${args.sourceLabel}`
            : `Compras — ${new Date().toLocaleDateString("es-AR")}`,
          sourceType: args.source === "recipe" ? "RECIPE" : "AUTO",
          status: "DRAFT",
        },
        select: { id: true },
      });
      targetListId = newList.id;
    }
  }

  const created = await prisma.shoppingListItem.createMany({
    data: args.items.map((item) => ({
      shoppingListId: targetListId!,
      itemName: item.canonicalName,
      quantity: item.quantity ?? null,
      unit: item.unit ?? null,
      category: item.category ?? "Otros",
      notes: item.notes ?? null,
    })),
  });

  return {
    listId: targetListId,
    itemsAdded: created.count,
    source: args.source ?? "manual",
  };
}
