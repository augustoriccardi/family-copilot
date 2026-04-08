import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/database/prisma";
import { createChatModel } from "@/lib/agent/util";
import { HumanMessage } from "@langchain/core/messages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: threadId } = await params;

  // Verify thread belongs to this user
  const thread = await prisma.thread.findFirst({ where: { id: threadId, userId } });
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only generate if title is still the default
  if (thread.title !== "New thread") {
    return NextResponse.json({ title: thread.title });
  }

  const body = await req.json().catch(() => ({}));
  const firstMessage = typeof body?.firstMessage === "string" ? body.firstMessage.slice(0, 500) : "";
  if (!firstMessage) return NextResponse.json({ title: thread.title });

  // Load household AI config
  let provider = "google";
  let model = "gemini-2.0-flash";
  let apiKey: string | undefined;

  const householdMember = await prisma.familyMember.findFirst({
    where: { linkedUserId: userId },
    include: { household: { include: { preferences: true } } },
  });
  const prefs = householdMember?.household?.preferences;
  if (prefs?.aiProvider) provider = prefs.aiProvider;
  if (prefs?.aiModel) model = prefs.aiModel;
  if (prefs?.aiApiKey) apiKey = prefs.aiApiKey;

  try {
    const llm = createChatModel({ provider, model, temperature: 0.3, apiKey });
    const response = await llm.invoke([
      new HumanMessage(
        `Generate a very short title (3-6 words, no punctuation at the end) for a conversation that starts with this message:\n\n"${firstMessage}"\n\nRespond with only the title, nothing else.`,
      ),
    ]);

    const raw = typeof response.content === "string" ? response.content : "";
    const title = raw.trim().replace(/^["']|["']$/g, "").slice(0, 80) || "New thread";

    await prisma.thread.update({ where: { id: threadId }, data: { title } });
    return NextResponse.json({ title });
  } catch {
    return NextResponse.json({ title: thread.title });
  }
}
