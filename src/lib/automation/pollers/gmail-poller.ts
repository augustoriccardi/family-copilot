import prisma from "@/lib/database/prisma";
import { dispatch } from "../dispatcher";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_EMAIL_CHARS = 4_000;

/**
 * Polls Gmail for new emails matching the configured label for each WatchedSource of type GMAIL_LABEL.
 * For each new email found, inserts an "inbox.email_received" event into automation_outbox.
 *
 * Called by /api/cron/pollers every 5 minutes.
 */
export async function runGmailPoller(householdId: string): Promise<{ queued: number }> {
  const sources = await prisma.watchedSource.findMany({
    where: { householdId, type: "GMAIL_LABEL", enabled: true },
  });

  let totalQueued = 0;

  for (const source of sources) {
    try {
      const label = getGmailLabelFromConfig(source.config);
      if (!label) continue;

      const memberId = source.memberId ?? undefined;
      const accessToken = await resolveAccessToken(memberId);
      if (!accessToken) continue;

      // Build query: label filter + after lastCheckedAt to avoid reprocessing
      const afterDate = source.lastCheckedAt
        ? `after:${Math.floor(source.lastCheckedAt.getTime() / 1000)}`
        : "";
      const q = `label:${label} is:unread ${afterDate}`.trim();

      const listRes = await fetch(
        `${GMAIL_API}/messages?maxResults=20&q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!listRes.ok) {
        console.error(
          `[gmail-poller] source ${source.id} list error ${listRes.status}`,
        );
        continue;
      }

      const listData = await listRes.json();
      const messageIds: string[] = (listData.messages ?? []).map(
        (m: { id: string }) => m.id,
      );

      if (messageIds.length === 0) {
        await prisma.watchedSource.update({
          where: { id: source.id },
          data: { lastCheckedAt: new Date() },
        });
        continue;
      }

      // Skip emails already queued (idempotency check via lastItemId)
      const alreadyQueued = new Set(source.lastItemId ? [source.lastItemId] : []);
      let lastId = source.lastItemId;

      for (const emailId of messageIds) {
        if (alreadyQueued.has(emailId)) continue;

        // Fetch email body
        const msgRes = await fetch(`${GMAIL_API}/messages/${emailId}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!msgRes.ok) continue;

        const msg = await msgRes.json();
        const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
        const get = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

        const body = extractTextBody(msg.payload).slice(0, MAX_EMAIL_CHARS);

        await dispatch({
          type: "inbox.email_received",
          householdId,
          payload: {
            emailId,
            memberId: memberId ?? null,
            sourceId: source.id,
            sourceName: source.name,
            subject: get("Subject"),
            from: get("From"),
            date: get("Date"),
            body,
          },
          source: "poller",
        });

        totalQueued++;
        lastId = emailId;
      }

      await prisma.watchedSource.update({
        where: { id: source.id },
        data: {
          lastCheckedAt: new Date(),
          ...(lastId ? { lastItemId: lastId } : {}),
        },
      });
    } catch (err) {
      console.error(`[gmail-poller] source ${source.id} error:`, (err as Error).message);
    }
  }

  return { queued: totalQueued };
}

// ── Helpers (duplicated from gmail.ts to avoid coupling the poller to agent tools) ──

async function resolveAccessToken(memberId: string | undefined): Promise<string | null> {
  if (!memberId) {
    // Fall back to global env token if configured
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken) return null;
    return exchangeRefreshToken(refreshToken).catch(() => null);
  }

  const conn = await prisma.calendarConnection.findFirst({
    where: { memberId, provider: "google" },
    select: { accessToken: true, refreshToken: true, expiresAt: true, id: true },
  });

  if (!conn) return null;

  const isExpired = conn.expiresAt ? conn.expiresAt <= new Date() : false;
  if (!isExpired) return conn.accessToken;

  if (!conn.refreshToken) return null;

  const newToken = await exchangeRefreshToken(conn.refreshToken);
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: { accessToken: newToken, expiresAt: new Date(Date.now() + 3600 * 1000) },
  });
  return newToken;
}

async function exchangeRefreshToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    const base64 = payload.body.data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  if (payload.parts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }
  return "";
}

function getGmailLabelFromConfig(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const maybeConfig = value as { label?: unknown };
  return typeof maybeConfig.label === "string" && maybeConfig.label.length > 0
    ? maybeConfig.label
    : null;
}
