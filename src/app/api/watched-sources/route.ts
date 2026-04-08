import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const householdId = searchParams.get("householdId");

  let resolvedHouseholdId = householdId;
  if (!resolvedHouseholdId) {
    const fallback = await prisma.household.findFirst({ select: { id: true } });
    resolvedHouseholdId = fallback?.id ?? null;
  }

  if (!resolvedHouseholdId) {
    return NextResponse.json({ error: "No household found" }, { status: 404 });
  }

  const sources = await prisma.watchedSource.findMany({
    where: { householdId: resolvedHouseholdId },
    include: {
      member: {
        select: { id: true, name: true, nickname: true, color: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(sources);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { householdId, type, name, config, memberId, enabled } = body as Record<string, unknown>;

  if (!type || typeof type !== "string") {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return NextResponse.json({ error: "config must be an object" }, { status: 400 });
  }

  let resolvedHouseholdId = typeof householdId === "string" ? householdId : null;
  if (!resolvedHouseholdId) {
    const fallback = await prisma.household.findFirst({ select: { id: true } });
    resolvedHouseholdId = fallback?.id ?? null;
  }
  if (!resolvedHouseholdId) {
    return NextResponse.json({ error: "No household found" }, { status: 404 });
  }

  const source = await prisma.watchedSource.create({
    data: {
      householdId: resolvedHouseholdId,
      type: type as "GMAIL_LABEL" | "WEBPAGE" | "RSS",
      name: name.trim(),
      config,
      memberId: typeof memberId === "string" && memberId ? memberId : null,
      enabled: typeof enabled === "boolean" ? enabled : true,
    },
    include: {
      member: { select: { id: true, name: true, nickname: true, color: true } },
    },
  });

  return NextResponse.json(source, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, name, config, memberId, enabled, type } = body as Record<string, unknown>;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (typeof name === "string") updateData.name = name.trim();
  if (config !== undefined) updateData.config = config;
  if (memberId !== undefined) updateData.memberId = memberId || null;
  if (typeof enabled === "boolean") updateData.enabled = enabled;
  if (typeof type === "string") updateData.type = type;

  const updated = await prisma.watchedSource.update({
    where: { id },
    data: updateData,
    include: {
      member: { select: { id: true, name: true, nickname: true, color: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await prisma.watchedSource.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
