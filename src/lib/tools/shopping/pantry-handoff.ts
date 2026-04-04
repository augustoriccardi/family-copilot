import prisma from "@/lib/database/prisma";
import type { AgentContext } from "../family/index";

/**
 * Marks the active (or specified) shopping list as PURCHASED
 * and upserts all its items into the household's pantry stock.
 */
export async function markListPurchasedAndUpdatePantryTool(
  args: { listId?: string },
  ctx: AgentContext,
) {
  const list = await prisma.shoppingList.findFirst({
    where: {
      householdId: ctx.householdId,
      ...(args.listId ? { id: args.listId } : { status: "ACTIVE" }),
    },
    include: { items: true },
  });

  if (!list) {
    return { error: "No se encontró una lista de compras activa." };
  }

  // Mark list as purchased
  await prisma.shoppingList.update({
    where: { id: list.id },
    data: { status: "PURCHASED" },
  });

  // Upsert each item into PantryItem
  const pantryUpdates = await Promise.all(
    list.items.map(async (item) => {
      const existing = await prisma.pantryItem.findFirst({
        where: { householdId: ctx.householdId, itemName: item.itemName },
      });

      if (existing) {
        const newQty =
          existing.quantity != null && item.quantity != null
            ? Number(existing.quantity) + Number(item.quantity)
            : (item.quantity ?? existing.quantity);

        await prisma.pantryItem.update({
          where: { id: existing.id },
          data: {
            quantity: newQty ?? undefined,
            unit: item.unit ?? existing.unit ?? undefined,
            category: item.category ?? existing.category ?? undefined,
          },
        });
        return { item: item.itemName, action: "updated" };
      } else {
        await prisma.pantryItem.create({
          data: {
            householdId: ctx.householdId,
            itemName: item.itemName,
            quantity: item.quantity ?? undefined,
            unit: item.unit ?? undefined,
            category: item.category ?? undefined,
          },
        });
        return { item: item.itemName, action: "added" };
      }
    }),
  );

  return {
    listId: list.id,
    listName: list.name,
    status: "PURCHASED",
    pantryUpdated: pantryUpdates.length,
    items: pantryUpdates,
  };
}
