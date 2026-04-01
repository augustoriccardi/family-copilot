import prisma from "@/lib/database/prisma";

export interface AgentContext {
  householdId: string;
}

/**
 * Resolves a household ID. If none is provided, returns the first household in the DB.
 * Returns null if no household exists (caller decides how to handle).
 */
export async function resolveHouseholdId(id?: string): Promise<string | null> {
  if (id) return id;
  const first = await prisma.household.findFirst({ select: { id: true } });
  return first?.id ?? null;
}

const NO_HOUSEHOLD_MSG = JSON.stringify({
  error:
    "No hay hogar configurado. Para usar funciones familiares, primero creá un hogar desde la interfaz web.",
});

export async function getFamilyContextTool(ctx: AgentContext) {
  const household = await prisma.household.findUnique({
    where: { id: ctx.householdId },
    include: {
      members: true,
      preferences: true,
      constraints: { include: { member: true } },
    },
  });

  if (!household) throw new Error("Hogar no encontrado");

  return {
    household: {
      name: household.name,
      timezone: household.timezone,
      currency: household.currency,
    },
    members: household.members.map((m) => ({
      id: m.id,
      name: m.name,
      nickname: m.nickname,
      role: m.role,
      birthdate: m.birthdate?.toISOString(),
      school: m.schoolName,
      notes: m.notes,
    })),
    preferences: household.preferences
      ? {
          supermarket: household.preferences.preferredSupermarket,
          weeklyBudget: household.preferences.weeklyBudget?.toString(),
          shoppingDay: household.preferences.shoppingDay,
          mealStyle: household.preferences.mealStyle,
          dietRules: household.preferences.dietRules,
        }
      : null,
    constraints: household.constraints.map((c) => ({
      member: c.member?.name ?? "Familia",
      type: c.type,
      key: c.key,
      value: c.value,
    })),
  };
}

export async function findFamilyMemberTool(args: { nameQuery: string }, ctx: AgentContext) {
  const members = await prisma.familyMember.findMany({
    where: {
      householdId: ctx.householdId,
      OR: [
        { name: { contains: args.nameQuery, mode: "insensitive" } },
        { nickname: { contains: args.nameQuery, mode: "insensitive" } },
      ],
    },
    include: { constraints: true },
  });

  return members.map((m) => ({
    id: m.id,
    name: m.name,
    nickname: m.nickname,
    role: m.role,
    birthdate: m.birthdate?.toISOString(),
    school: m.schoolName,
    constraints: m.constraints.map((c) => ({
      type: c.type,
      key: c.key,
      value: c.value,
    })),
  }));
}

export async function getMemberScheduleRulesTool(args: { memberId: string }, ctx: AgentContext) {
  const constraints = await prisma.familyConstraint.findMany({
    where: {
      householdId: ctx.householdId,
      memberId: args.memberId,
      type: "SCHEDULE_RULE",
    },
  });

  const recurringEvents = await prisma.calendarEvent.findMany({
    where: {
      householdId: ctx.householdId,
      memberId: args.memberId,
      isRecurring: true,
    },
    select: { title: true, startsAt: true, endsAt: true, recurrenceRule: true },
  });

  return {
    rules: constraints.map((c) => ({ key: c.key, value: c.value })),
    recurringEvents: recurringEvents.map((e) => ({
      title: e.title,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      recurrenceRule: e.recurrenceRule,
    })),
  };
}

export async function getPantryItemsTool(ctx: AgentContext) {
  const items = await prisma.pantryItem.findMany({
    where: { householdId: ctx.householdId },
    orderBy: { category: "asc" },
  });

  return items.map((i) => ({
    id: i.id,
    name: i.itemName,
    quantity: i.quantity?.toString(),
    unit: i.unit,
    category: i.category,
    expirationDate: i.expirationDate?.toISOString(),
  }));
}

export async function updatePantryTool(
  args: {
    items: Array<{
      itemName: string;
      quantity?: number;
      unit?: string;
      category?: string;
      expirationDate?: string;
    }>;
  },
  ctx: AgentContext,
) {
  const results = [];

  for (const item of args.items) {
    const existing = await prisma.pantryItem.findFirst({
      where: {
        householdId: ctx.householdId,
        itemName: { equals: item.itemName, mode: "insensitive" },
      },
    });

    if (existing) {
      const updated = await prisma.pantryItem.update({
        where: { id: existing.id },
        data: {
          quantity: item.quantity,
          unit: item.unit ?? existing.unit,
          category: item.category ?? existing.category,
          expirationDate: item.expirationDate
            ? new Date(item.expirationDate)
            : existing.expirationDate,
        },
      });
      results.push({ action: "updated", item: updated.itemName });
    } else {
      const created = await prisma.pantryItem.create({
        data: {
          householdId: ctx.householdId,
          itemName: item.itemName,
          quantity: item.quantity,
          unit: item.unit,
          category: item.category,
          expirationDate: item.expirationDate ? new Date(item.expirationDate) : undefined,
        },
      });
      results.push({ action: "created", item: created.itemName });
    }
  }

  return { updated: results.length, results };
}
