import prisma from "@/lib/database/prisma";
import type { AgentContext } from "./index";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_EMAIL_CHARS = 4_000;

interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
}

/**
 * Exchanges a refresh token for a new access token via Google OAuth.
 */
async function exchangeRefreshToken(refreshToken: string): Promise<string> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Faltan variables de entorno: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${err.substring(0, 200)}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

/**
 * Resolves a valid access token for Gmail for the given member.
 * Requires the member to be identified and have a Google CalendarConnection.
 * Never falls back to another person's account.
 */
async function resolveAccessToken(
  memberId: string | undefined,
): Promise<{ accessToken: string; memberEmail: string | null }> {
  if (!memberId) {
    throw new Error(
      "Identificate primero en Settings → '¿Quién sos?' para que el agente pueda leer tus correos.",
    );
  }

  const conn = await prisma.calendarConnection.findFirst({
    where: { memberId, provider: "google" },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
      providerEmail: true,
    },
  });

  if (!conn) {
    throw new Error(
      'No tenés una cuenta Google conectada. Conectala desde Settings → "Conectar Google".',
    );
  }

  const isExpired = conn.expiresAt ? conn.expiresAt <= new Date() : false;
  if (!isExpired) {
    return { accessToken: conn.accessToken, memberEmail: conn.providerEmail };
  }

  if (!conn.refreshToken) {
    throw new Error(
      'El token de Google expiró. Volvé a conectar tu cuenta desde Settings → "Conectar Google".',
    );
  }

  const newToken = await exchangeRefreshToken(conn.refreshToken);
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: { accessToken: newToken, expiresAt: new Date(Date.now() + 3600 * 1000) },
  });
  return { accessToken: newToken, memberEmail: conn.providerEmail };
}

/**
 * Decodes a base64url-encoded Gmail message part body.
 */
function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Extracts plain text from a Gmail message payload (handles multipart).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextBody(payload: any): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
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

/**
 * Fetches a list of recent emails from Gmail.
 * Uses the CalendarConnection token for the specified member if available,
 * falls back to the global GOOGLE_REFRESH_TOKEN env var.
 */
export async function readGmailInboxTool(
  args: { maxResults?: number; query?: string; memberId?: string },
  ctx: AgentContext,
) {
  const memberId = args.memberId ?? ctx.callerId;

  let accessToken: string;
  let memberEmail: string | null;
  try {
    ({ accessToken, memberEmail } = await resolveAccessToken(memberId));
  } catch (e) {
    return {
      error: `No se pudo obtener el token de Google: ${(e as Error).message}`,
    };
  }

  const maxResults = args.maxResults ?? 20;
  // Default query: unread + skip promotions/social
  const q = args.query ?? "is:unread -category:promotions -category:social";

  // 1. List message IDs
  const listRes = await fetch(
    `${GMAIL_API}/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!listRes.ok) {
    const err = await listRes.text();
    if (listRes.status === 403) {
      return {
        error:
          "Sin permiso para leer correos. Regenerá el GOOGLE_REFRESH_TOKEN ejecutando 'node scripts/get-google-token.mjs' (ya incluye el scope gmail.readonly).",
      };
    }
    return { error: `Gmail API error ${listRes.status}: ${err.substring(0, 200)}` };
  }

  const listData = await listRes.json();
  const messageIds: string[] = (listData.messages ?? []).map((m: { id: string }) => m.id);

  if (messageIds.length === 0) {
    return {
      emails: [],
      count: 0,
      note: "No hay correos no leídos que coincidan con la búsqueda.",
    };
  }

  // 2. Fetch each message
  const emails: GmailMessage[] = [];
  for (const id of messageIds) {
    try {
      const msgRes = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!msgRes.ok) continue;
      const msg = await msgRes.json();

      const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
      const get = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

      const body = extractTextBody(msg.payload).slice(0, MAX_EMAIL_CHARS);

      emails.push({
        id,
        subject: get("Subject"),
        from: get("From"),
        date: get("Date"),
        snippet: msg.snippet ?? "",
        body,
      });
    } catch {
      // skip failed individual messages
    }
  }

  return {
    count: emails.length,
    query: q,
    account: memberEmail ?? "cuenta global",
    emails,
  };
}
