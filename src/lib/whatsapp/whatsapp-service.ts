/**
 * WhatsApp Cloud API client.
 * Wraps the Meta Graph API for sending messages via the WhatsApp Business platform.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 */

const GRAPH_API_VERSION = "v19.0";

function apiUrl() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
}

function accessToken() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
  return token;
}

/**
 * Sends a plain text message to a WhatsApp number.
 * @param to - E.164 phone number (e.g. "5491123456789")
 * @param text - Message body (max 4096 chars)
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  // Split messages longer than 4096 chars (WhatsApp limit)
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    const response = await fetch(apiUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: chunk, preview_url: false },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`WhatsApp API error ${response.status}: ${JSON.stringify(err)}`);
    }
  }
}

/**
 * Marks an incoming message as read (shows double blue tick to the user).
 */
export async function markMessageAsRead(messageId: string): Promise<void> {
  await fetch(apiUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  }).catch(() => {
    // Best-effort — don't fail the whole request if this fails
  });
}

/**
 * Downloads a WhatsApp media file given its mediaId.
 * Returns the file content as a Buffer plus its MIME type.
 * Uses the two-step process: first get the download URL, then fetch the bytes.
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  const token = accessToken();
  const version = GRAPH_API_VERSION;

  // Step 1: retrieve the media URL from Meta
  const metaRes = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!metaRes.ok) {
    console.error("[whatsapp] Failed to retrieve media URL", mediaId, metaRes.status);
    return null;
  }

  const meta = (await metaRes.json()) as { url: string; mime_type: string; id: string };

  // Step 2: download the actual bytes
  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!fileRes.ok) {
    console.error("[whatsapp] Failed to download media bytes", mediaId, fileRes.status);
    return null;
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const mimeType = meta.mime_type ?? "application/octet-stream";

  // Derive a reasonable filename from mimeType (WhatsApp doesn't provide one for most types)
  const ext = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
  const filename = `whatsapp-${mediaId}.${ext}`;

  return { buffer, mimeType, filename };
}

/**
 * Splits text into chunks of at most 4096 characters, breaking at newlines when possible.
 */
function splitMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Try to split at a newline near the limit
    const slice = remaining.slice(0, maxLen);
    const lastNewline = slice.lastIndexOf("\n");
    const cutAt = lastNewline > maxLen / 2 ? lastNewline : maxLen;

    chunks.push(remaining.slice(0, cutAt).trimEnd());
    remaining = remaining.slice(cutAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
