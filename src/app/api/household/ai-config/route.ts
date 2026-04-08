import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  aiProvider: z.string().optional(),
  aiModel: z.string().optional(),
  aiApiKey: z.string().optional(),
});

async function getHouseholdId(userId: string): Promise<string | null> {
  // Check if user is the household owner
  const owned = await prisma.household.findFirst({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (owned) return owned.id;

  // Check if user is a linked family member
  const member = await prisma.familyMember.findFirst({
    where: { linkedUserId: userId },
    select: { householdId: true },
  });
  return member?.householdId ?? null;
}

async function isHouseholdOwner(userId: string, householdId: string): Promise<boolean> {
  const household = await prisma.household.findFirst({
    where: { id: householdId, ownerUserId: userId },
    select: { id: true },
  });
  return !!household;
}

/**
 * GET /api/household/ai-config — returns AI config for the household
 * The API key is masked (last 4 chars only) for security.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const householdId = await getHouseholdId(session.user.id);
  if (!householdId) {
    return NextResponse.json({
      aiProvider: null,
      aiModel: null,
      aiApiKeySet: false,
      isOwner: false,
    });
  }

  const [prefs, owner] = await Promise.all([
    prisma.householdPreferences.findUnique({
      where: { householdId },
      select: { aiProvider: true, aiModel: true, aiApiKey: true },
    }),
    isHouseholdOwner(session.user.id, householdId),
  ]);

  return NextResponse.json({
    aiProvider: prefs?.aiProvider ?? null,
    aiModel: prefs?.aiModel ?? null,
    aiApiKeySet: !!prefs?.aiApiKey,
    aiApiKeyHint: prefs?.aiApiKey ? `...${prefs.aiApiKey.slice(-4)}` : null,
    isOwner: owner,
  });
}

/**
 * PATCH /api/household/ai-config — upserts AI config for the household
 * Send aiApiKey: "" to clear it.
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const householdId = await getHouseholdId(session.user.id);
  if (!householdId) {
    return NextResponse.json({ error: "No hay hogar configurado" }, { status: 404 });
  }

  const owner = await isHouseholdOwner(session.user.id, householdId);
  if (!owner) {
    return NextResponse.json(
      { error: "Solo el dueño del hogar puede modificar esta configuración" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  console.log(
    "[ai-config PATCH] body received:",
    JSON.stringify({
      ...body,
      aiApiKey: body.aiApiKey ? `${String(body.aiApiKey).slice(0, 6)}...` : body.aiApiKey,
    }),
  );
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { aiProvider, aiModel, aiApiKey } = parsed.data;
  console.log("[ai-config PATCH] parsed:", {
    aiProvider,
    aiModel,
    aiApiKey: aiApiKey ? `${aiApiKey.slice(0, 6)}...` : aiApiKey,
  });

  const prefs = await prisma.householdPreferences.upsert({
    where: { householdId },
    create: {
      householdId,
      aiProvider: aiProvider ?? null,
      aiModel: aiModel ?? null,
      aiApiKey: aiApiKey || null,
    },
    update: {
      ...(aiProvider !== undefined && { aiProvider }),
      ...(aiModel !== undefined && { aiModel }),
      ...(aiApiKey !== undefined && { aiApiKey: aiApiKey || null }),
    },
    select: { aiProvider: true, aiModel: true, aiApiKey: true },
  });

  return NextResponse.json({
    aiProvider: prefs.aiProvider,
    aiModel: prefs.aiModel,
    aiApiKeySet: !!prefs.aiApiKey,
    aiApiKeyHint: prefs.aiApiKey ? `...${prefs.aiApiKey.slice(-4)}` : null,
  });
}
