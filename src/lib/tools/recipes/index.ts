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
