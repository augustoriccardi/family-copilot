/**
 * WhatsApp Cloud API webhook endpoint.
 *
 * GET  — Meta webhook verification (hub.challenge handshake)
 * POST — Incoming messages from WhatsApp users
 *
 * Security:
 * - Signature verification via HMAC SHA256 (x-hub-signature-256 header)
 * - Skip verification only when WHATSAPP_APP_SECRET is not set (dev mode)
 *
 * Processing:
 * - Status updates (delivered/read receipts) are acknowledged and ignored
 * - Text messages are forwarded to the LangGraph agent via handleWhatsAppMessage()
 * - Response is sent back to the user via sendWhatsAppMessage()
 * - All processing happens synchronously within the request lifetime
 *   (Next.js Edge/Node functions keep the connection open until the async work finishes)
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { handleWhatsAppMessage } from "@/lib/whatsapp/whatsapp-agent";
import { sendWhatsAppMessage, markMessageAsRead, downloadWhatsAppMedia } from "@/lib/whatsapp/whatsapp-service";
import { uploadFile } from "@/lib/storage/upload";
import { v4 as uuidv4 } from "uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Signature verification ──────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    // Dev mode: skip verification if secret is not configured
    console.warn("[whatsapp] WHATSAPP_APP_SECRET not set — skipping signature check");
    return true;
  }

  if (!signature?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signature.slice(7);

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

// ── GET — Meta webhook verification ────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

// ── POST — Incoming WhatsApp messages ──────────────────────────────────────

export async function POST(request: NextRequest) {
  let rawBody: string;

  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ status: "error" }, { status: 400 });
  }

  // Verify the request came from Meta
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifySignature(rawBody, signature)) {
    console.warn("[whatsapp] Invalid webhook signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: WhatsAppWebhookPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ status: "error" }, { status: 400 });
  }

  const value = body.entry?.[0]?.changes?.[0]?.value;

  // Acknowledge delivery/read status updates immediately — nothing to process
  if (value?.statuses) {
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }

  const message = value?.messages?.[0];
  if (!message) {
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }

  // Respond to Meta immediately to avoid retries, then process in background
  // We use a detached async function but still await it within the request lifetime
  // because Next.js Node runtime keeps the function alive until the Promise resolves.
  processIncoming(message).catch((err) => {
    console.error("[whatsapp] Unhandled error in processIncoming", err);
  });

  return NextResponse.json({ status: "ok" }, { status: 200 });
}

// ── Message processing ──────────────────────────────────────────────────────

async function processIncoming(message: WhatsAppMessage) {
  const { id: messageId, from: fromPhone, type: messageType } = message;

  // Mark as read so the user sees the blue ticks
  await markMessageAsRead(messageId);

  const userText = message.text?.body?.trim() ?? "";

  // ── Media messages (image, document, audio, video, sticker) ──────────────
  // Supported for inbox analysis: image, document
  // Unsupported types get a friendly reply
  const SUPPORTED_MEDIA_TYPES = ["image", "document"];
  const UNSUPPORTED_MEDIA_TYPES = ["audio", "video", "sticker", "location", "contacts"];

  if (UNSUPPORTED_MEDIA_TYPES.includes(messageType)) {
    await sendWhatsAppMessage(
      fromPhone,
      "Por ahora solo proceso texto, imágenes y documentos (PDF). 😊 Escribime o mandame una foto o archivo.",
    );
    return;
  }

  let attachments: import("@/types/message").FileAttachment[] = [];

  if (SUPPORTED_MEDIA_TYPES.includes(messageType)) {
    const mediaId =
      (message as WhatsAppMessage & { image?: { id: string }; document?: { id: string } })
        .image?.id ??
      (message as WhatsAppMessage & { image?: { id: string }; document?: { id: string } })
        .document?.id;

    if (mediaId) {
      try {
        const media = await downloadWhatsAppMedia(mediaId);
        if (media) {
          const fileKey = `uploads/${uuidv4()}.${media.mimeType.split("/")[1]?.split(";")[0] ?? "bin"}`;
          const fileUrl = await uploadFile(media.buffer, fileKey, media.mimeType, media.filename);
          attachments = [
            {
              url: fileUrl,
              key: fileKey,
              name: media.filename,
              type: media.mimeType,
              size: media.buffer.length,
            },
          ];
        }
      } catch (err) {
        console.error("[whatsapp] Failed to process media", { mediaId, err });
      }
    }

    // If no text caption, use a default prompt for the agent
    if (!userText && attachments.length === 0) {
      await sendWhatsAppMessage(
        fromPhone,
        "No pude procesar el archivo. Intentá de nuevo o mandame el texto directamente.",
      );
      return;
    }
  } else if (messageType !== "text" || !userText) {
    // Unknown type or empty text
    return;
  }

  try {
    const reply = await handleWhatsAppMessage(fromPhone, userText, attachments.length > 0 ? attachments : undefined);
    if (reply) {
      await sendWhatsAppMessage(fromPhone, reply);
    }
  } catch (err) {
    console.error("[whatsapp] Error processing message", { fromPhone, err });
    await sendWhatsAppMessage(
      fromPhone,
      "Ocurrió un error procesando tu mensaje. Por favor intentá de nuevo en un momento. 🙏",
    ).catch(() => {});
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

interface WhatsAppMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type?: string; sha256?: string; caption?: string };
  document?: { id: string; mime_type?: string; filename?: string; sha256?: string; caption?: string };
  timestamp: string;
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppMessage[];
        statuses?: unknown[];
      };
    }>;
  }>;
}
