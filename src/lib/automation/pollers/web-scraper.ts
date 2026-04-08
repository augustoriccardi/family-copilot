import prisma from "@/lib/database/prisma";
import { dispatch } from "../dispatcher";
import { createChatModel, DEFAULT_MODEL_NAME, DEFAULT_MODEL_PROVIDER } from "@/lib/agent/util";
import { HumanMessage } from "@langchain/core/messages";

const MAX_HTML_CHARS = 8_000;

/**
 * Polls configured web pages for new events.
 * Strips HTML, passes content to gpt-4o-mini to extract structured events,
 * and inserts "inbox.page_scraped" events into automation_outbox.
 *
 * Called by /api/cron/pollers every 5 minutes (daily filtering via lastCheckedAt).
 */
export async function runWebScraperPoller(householdId: string): Promise<{ queued: number }> {
  const sources = await prisma.watchedSource.findMany({
    where: { householdId, type: "WEBPAGE", enabled: true },
  });

  let totalQueued = 0;

  for (const source of sources) {
    try {
      // Re-check at most once per day for web pages
      if (source.lastCheckedAt) {
        const hoursSinceLast =
          (Date.now() - source.lastCheckedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLast < 24) continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const configRaw = source.config as any;
      const url: string | null =
        configRaw && typeof configRaw === "object" && typeof configRaw.url === "string"
          ? configRaw.url
          : null;
      if (!url) continue;

      // Fetch the page
      const res = await fetch(url, {
        headers: { "User-Agent": "FamilyCopilot/1.0 (+family-copilot)" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error(`[web-scraper] ${url} responded ${res.status}`);
        continue;
      }

      const html = await res.text();
      const text = stripHtml(html).slice(0, MAX_HTML_CHARS);

      if (text.trim().length < 50) {
        // Page too short or blocked
        continue;
      }

      // LLM extraction
      const llm = createChatModel({
        provider: DEFAULT_MODEL_PROVIDER,
        model: DEFAULT_MODEL_NAME,
        temperature: 0,
      });

      const extractionPrompt = [
        `Extraé todos los eventos con fecha del siguiente texto de una página web.`,
        `Devolvé un array JSON de objetos con campos: title, date (ISO 8601), description (opcional), location (opcional).`,
        `Si no hay eventos con fecha, devolvé un array vacío: [].`,
        `SOLO devolvé el array JSON, sin explicación adicional.`,
        ``,
        `Texto:`,
        text,
      ].join("\n");

      let events: unknown[] = [];
      try {
        const response = await llm.invoke([new HumanMessage(extractionPrompt)]);
        const raw = String(
          typeof response.content === "string"
            ? response.content
            : (response.content as { text?: string }[])[0]?.text ?? "",
        ).trim();

        // Extract JSON array from response (may be wrapped in markdown)
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          events = JSON.parse(jsonMatch[0]);
        }
      } catch (err) {
        console.error(`[web-scraper] LLM extraction failed for ${url}:`, (err as Error).message);
        continue;
      }

      if (!Array.isArray(events) || events.length === 0) {
        await prisma.watchedSource.update({
          where: { id: source.id },
          data: { lastCheckedAt: new Date() },
        });
        continue;
      }

      // Compute a fingerprint to detect new content vs already-processed
      const contentHash = hashContent(
        events.map((e) => (e as Record<string, unknown>).title).join("|"),
      );

      if (source.lastItemId === contentHash) {
        // Same content as last time, nothing new
        await prisma.watchedSource.update({
          where: { id: source.id },
          data: { lastCheckedAt: new Date() },
        });
        continue;
      }

      await dispatch({
        type: "inbox.page_scraped",
        householdId,
        payload: {
          url,
          sourceId: source.id,
          sourceName: source.name,
          memberId: source.memberId ?? null,
          events,
        },
        source: "poller",
      });

      totalQueued++;

      await prisma.watchedSource.update({
        where: { id: source.id },
        data: { lastCheckedAt: new Date(), lastItemId: contentHash },
      });
    } catch (err) {
      console.error(`[web-scraper] source ${source.id} error:`, (err as Error).message);
    }
  }

  return { queued: totalQueued };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hashContent(content: string): string {
  // Simple deterministic hash for change detection (not cryptographic)
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = (Math.imul(31, h) + content.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
