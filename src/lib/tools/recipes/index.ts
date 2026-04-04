import prisma from "@/lib/database/prisma";
import type { AgentContext } from "../family/index";

export async function saveRecipeTool(
  args: {
    title: string;
    description?: string;
    servings?: number;
    prepTimeMinutes?: number;
    cookTimeMinutes?: number;
    tags?: string[];
    instructions?: string;
    sourceType: "AUDIO" | "IMAGE" | "TEXT" | "LINK" | "MANUAL";
    sourceUrl?: string;
    imageUrl?: string;
    ingredients: Array<{
      name: string;
      quantity?: number;
      unit?: string;
      optional?: boolean;
      category?: string;
    }>;
  },
  ctx: AgentContext,
) {
  const recipe = await prisma.recipe.create({
    data: {
      householdId: ctx.householdId,
      title: args.title,
      description: args.description,
      servings: args.servings,
      prepTimeMinutes: args.prepTimeMinutes,
      cookTimeMinutes: args.cookTimeMinutes,
      tags: args.tags ?? [],
      instructions: args.instructions,
      sourceType: args.sourceType,
      sourceUrl: args.sourceUrl,
      imageUrl: args.imageUrl,
      ingredients: {
        create: args.ingredients.map((ing) => ({
          ingredientName: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          optional: ing.optional ?? false,
          category: ing.category,
        })),
      },
    },
    include: { ingredients: true },
  });

  return {
    recipeId: recipe.id,
    title: recipe.title,
    ingredientCount: recipe.ingredients.length,
    tags: recipe.tags,
  };
}

export async function searchRecipesTool(
  args: {
    query?: string;
    tags?: string[];
    maxPrepTimeMinutes?: number;
  },
  ctx: AgentContext,
) {
  const where: Record<string, unknown> = {
    householdId: ctx.householdId,
  };

  if (args.query) {
    where.OR = [
      { title: { contains: args.query, mode: "insensitive" } },
      { description: { contains: args.query, mode: "insensitive" } },
    ];
  }

  if (args.tags?.length) {
    where.tags = { hasSome: args.tags };
  }

  if (args.maxPrepTimeMinutes) {
    where.prepTimeMinutes = { lte: args.maxPrepTimeMinutes };
  }

  const recipes = await prisma.recipe.findMany({
    where,
    include: { ingredients: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return recipes.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    servings: r.servings,
    prepTimeMinutes: r.prepTimeMinutes,
    cookTimeMinutes: r.cookTimeMinutes,
    tags: r.tags,
    ingredientCount: r.ingredients.length,
  }));
}

export async function updateRecipeTool(
  args: {
    recipeId: string;
    title?: string;
    description?: string;
    servings?: number;
    prepTimeMinutes?: number;
    cookTimeMinutes?: number;
    tags?: string[];
    instructions?: string;
    imageUrl?: string;
    /** Si se pasa, reemplaza TODOS los ingredientes actuales */
    ingredients?: Array<{
      name: string;
      quantity?: number;
      unit?: string;
      optional?: boolean;
      category?: string;
    }>;
  },
  ctx: AgentContext,
) {
  const existing = await prisma.recipe.findFirst({
    where: { id: args.recipeId, householdId: ctx.householdId },
  });
  if (!existing) throw new Error("Receta no encontrada");

  const { recipeId, ingredients, ...fields } = args;

  const recipe = await prisma.recipe.update({
    where: { id: recipeId },
    data: {
      ...fields,
      ...(ingredients !== undefined && {
        ingredients: {
          deleteMany: {},
          create: ingredients.map((ing) => ({
            ingredientName: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            optional: ing.optional ?? false,
            category: ing.category,
          })),
        },
      }),
    },
    include: { ingredients: true },
  });

  return {
    recipeId: recipe.id,
    title: recipe.title,
    ingredientCount: recipe.ingredients.length,
  };
}

export async function deleteRecipeTool(args: { recipeId: string }, ctx: AgentContext) {
  const existing = await prisma.recipe.findFirst({
    where: { id: args.recipeId, householdId: ctx.householdId },
  });
  if (!existing) throw new Error("Receta no encontrada");

  await prisma.recipe.delete({ where: { id: args.recipeId } });
  return { deleted: true, recipeId: args.recipeId };
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE INGREDIENT INTENT (recipe → shopping handoff)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes ingredient list of a recipe to ProductIntentItem[] for shopping handoff.
 */
export async function createIngredientIntentTool(
  args: { recipeId: string; memberId?: string },
  ctx: AgentContext,
) {
  const recipe = await prisma.recipe.findFirst({
    where: { id: args.recipeId, householdId: ctx.householdId },
    include: { ingredients: true },
  });

  if (!recipe) return { error: `Receta con ID "${args.recipeId}" no encontrada.` };

  const UNIT_MAP: Record<string, string> = {
    gramo: "g",
    gramos: "g",
    gr: "g",
    kilogramo: "kg",
    kilogramos: "kg",
    kg: "kg",
    litro: "l",
    litros: "l",
    lt: "l",
    mililitro: "ml",
    mililitros: "ml",
    ml: "ml",
    unidad: "unit",
    unidades: "unit",
    u: "unit",
    pack: "pack",
    paquete: "pack",
    paquetes: "pack",
  };

  const items = recipe.ingredients.map((ing) => {
    const rawUnit = (ing.unit ?? "unit").toLowerCase().trim();
    const normalizedUnit = UNIT_MAP[rawUnit] ?? "unit";
    const validUnit = ["unit", "kg", "g", "l", "ml", "pack"].includes(normalizedUnit)
      ? (normalizedUnit as "unit" | "kg" | "g" | "l" | "ml" | "pack")
      : "unit";

    return {
      category: (ing.category?.toLowerCase() as "grocery") ?? "grocery",
      canonicalName: ing.ingredientName,
      quantity: Number(ing.quantity ?? 1),
      unit: validUnit,
      memberId: args.memberId ?? null,
      substitutesAllowed: true,
    };
  });

  return {
    recipeId: recipe.id,
    recipeTitle: recipe.title,
    items,
    instruction:
      "Estos son los ProductIntentItem[] de la receta. Trasladálos al agente shopping para agregarlos a la lista de compras.",
  };
}
