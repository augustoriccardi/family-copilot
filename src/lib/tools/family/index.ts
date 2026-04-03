import prisma from "@/lib/database/prisma";

export interface AgentContext {
  householdId: string;
  callerId?: string;
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

// ── FamilyConstraint CRUD ─────────────────────────────────────────────────

export async function upsertConstraintTool(
  args: {
    memberId?: string; // null = hogar entero
    type: "ALLERGY" | "DISLIKE" | "MEDICATION" | "SCHEDULE_RULE" | "DIET" | "OTHER";
    key: string;
    value: string;
  },
  ctx: AgentContext,
) {
  const existing = await prisma.familyConstraint.findFirst({
    where: {
      householdId: ctx.householdId,
      memberId: args.memberId ?? null,
      type: args.type,
      key: { equals: args.key, mode: "insensitive" },
    },
  });

  if (existing) {
    const updated = await prisma.familyConstraint.update({
      where: { id: existing.id },
      data: { value: args.value },
    });
    return {
      action: "updated",
      id: updated.id,
      type: updated.type,
      key: updated.key,
      value: updated.value,
    };
  }

  const created = await prisma.familyConstraint.create({
    data: {
      householdId: ctx.householdId,
      memberId: args.memberId ?? null,
      type: args.type,
      key: args.key,
      value: args.value,
    },
  });
  return {
    action: "created",
    id: created.id,
    type: created.type,
    key: created.key,
    value: created.value,
  };
}

export async function deleteConstraintTool(args: { constraintId: string }, ctx: AgentContext) {
  const constraint = await prisma.familyConstraint.findFirst({
    where: { id: args.constraintId, householdId: ctx.householdId },
  });
  if (!constraint) return { success: false, error: "Restricción no encontrada" };

  await prisma.familyConstraint.delete({ where: { id: args.constraintId } });
  return { success: true, deleted: { type: constraint.type, key: constraint.key } };
}

export async function listConstraintsTool(args: { memberId?: string }, ctx: AgentContext) {
  const constraints = await prisma.familyConstraint.findMany({
    where: {
      householdId: ctx.householdId,
      ...(args.memberId ? { memberId: args.memberId } : {}),
    },
    include: { member: { select: { name: true } } },
    orderBy: [{ type: "asc" }, { key: "asc" }],
  });

  return constraints.map((c) => ({
    id: c.id,
    member: c.member?.name ?? "Familia",
    memberId: c.memberId,
    type: c.type,
    key: c.key,
    value: c.value,
  }));
}

// ── FamilyMember CRUD ─────────────────────────────────────────────────────

export async function addFamilyMemberTool(
  args: {
    name: string;
    role: "MADRE" | "PADRE" | "HIJO" | "HIJA" | "ABUELO" | "ABUELA" | "OTRO";
    nickname?: string;
    birthdate?: string;
    schoolName?: string;
    isMinor?: boolean;
    notes?: string;
    color?: string;
  },
  ctx: AgentContext,
) {
  const member = await prisma.familyMember.create({
    data: {
      householdId: ctx.householdId,
      name: args.name,
      role: args.role,
      nickname: args.nickname,
      birthdate: args.birthdate ? new Date(args.birthdate) : undefined,
      schoolName: args.schoolName,
      isMinor: args.isMinor ?? false,
      notes: args.notes,
      color: args.color,
    },
  });
  return { id: member.id, name: member.name, role: member.role };
}

export async function updateFamilyMemberTool(
  args: {
    memberId: string;
    name?: string;
    nickname?: string;
    birthdate?: string;
    schoolName?: string;
    notes?: string;
    color?: string;
  },
  ctx: AgentContext,
) {
  const member = await prisma.familyMember.findFirst({
    where: { id: args.memberId, householdId: ctx.householdId },
  });
  if (!member) return { success: false, error: "Integrante no encontrado" };

  const updated = await prisma.familyMember.update({
    where: { id: args.memberId },
    data: {
      ...(args.name !== undefined && { name: args.name }),
      ...(args.nickname !== undefined && { nickname: args.nickname }),
      ...(args.birthdate !== undefined && { birthdate: new Date(args.birthdate) }),
      ...(args.schoolName !== undefined && { schoolName: args.schoolName }),
      ...(args.notes !== undefined && { notes: args.notes }),
      ...(args.color !== undefined && { color: args.color }),
    },
  });
  return { success: true, id: updated.id, name: updated.name };
}

// ── HouseholdPreferences UPDATE ───────────────────────────────────────────

export async function updateHouseholdPreferencesTool(
  args: {
    preferredSupermarket?: string;
    weeklyBudget?: number;
    shoppingDay?: string;
    mealStyle?: string;
  },
  ctx: AgentContext,
) {
  const prefs = await prisma.householdPreferences.upsert({
    where: { householdId: ctx.householdId },
    create: {
      householdId: ctx.householdId,
      preferredSupermarket: args.preferredSupermarket,
      weeklyBudget: args.weeklyBudget,
      shoppingDay: args.shoppingDay,
      mealStyle: args.mealStyle,
    },
    update: {
      ...(args.preferredSupermarket !== undefined && {
        preferredSupermarket: args.preferredSupermarket,
      }),
      ...(args.weeklyBudget !== undefined && { weeklyBudget: args.weeklyBudget }),
      ...(args.shoppingDay !== undefined && { shoppingDay: args.shoppingDay }),
      ...(args.mealStyle !== undefined && { mealStyle: args.mealStyle }),
    },
  });
  return {
    success: true,
    supermarket: prefs.preferredSupermarket,
    weeklyBudget: prefs.weeklyBudget?.toString(),
    shoppingDay: prefs.shoppingDay,
    mealStyle: prefs.mealStyle,
  };
}

// ── PantryItem DELETE ─────────────────────────────────────────────────────

export async function deletePantryItemTool(args: { itemName: string }, ctx: AgentContext) {
  const item = await prisma.pantryItem.findFirst({
    where: {
      householdId: ctx.householdId,
      itemName: { equals: args.itemName, mode: "insensitive" },
    },
  });
  if (!item) return { success: false, error: "Producto no encontrado en la despensa" };

  await prisma.pantryItem.delete({ where: { id: item.id } });
  return { success: true, deleted: item.itemName };
}
