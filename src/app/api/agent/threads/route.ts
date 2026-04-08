import { NextRequest, NextResponse } from "next/server";
import type { Thread } from "@/types/message";
import prisma from "@/lib/database/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ThreadEntity = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

/** auth() reads the session from next/headers — the correct v5 approach for route handlers. */
async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dbThreads = await prisma.thread.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const threads: Thread[] = dbThreads.map((t: ThreadEntity) => ({
    id: t.id,
    title: t.title,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));
  return NextResponse.json(threads, { status: 200 });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const created = await prisma.thread.create({ data: { title: "New thread", userId } });
  const thread: Thread = {
    id: created.id,
    title: created.title,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
  return NextResponse.json(thread, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const { id, title } = body || {};
    if (!id || typeof title !== "string") {
      return NextResponse.json({ error: "id and title required" }, { status: 400 });
    }
    const updated = await prisma.thread.update({ where: { id }, data: { title } });
    return NextResponse.json(
      {
        id: updated.id,
        title: updated.title,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const { id } = body || {};
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Thread id required" }, { status: 400 });
    }
    const thread = await prisma.thread.findUnique({ where: { id } });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    await prisma.thread.delete({ where: { id } });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
