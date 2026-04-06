import pdfParse from "pdf-parse";
import prisma from "@/lib/database/prisma";
import { getFile } from "@/lib/storage/upload";
import { BUCKET_NAME } from "@/lib/storage/s3-client";
import type { EventCandidate, ProductIntentItem, InboxCandidate } from "@/types/agent-contracts";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

export interface AgentContext {
  householdId: string;
  callerId?: string;
}

const MAX_TEXT_CHARS = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a file to base64 data URL (for images) or plain text (for PDFs/text).
 * Used to pass document content to the LLM for extraction.
 */
async function resolveFileContent(
  fileKey: string,
  mimeType: string,
): Promise<{ type: "image_base64"; dataUrl: string } | { type: "text"; text: string } | null> {
  try {
    const buffer = await getFile(fileKey);

    if (mimeType.startsWith("image/")) {
      const base64 = buffer.toString("base64");
      return { type: "image_base64", dataUrl: `data:${mimeType};base64,${base64}` };
    }

    if (mimeType === "application/pdf") {
      const data = await pdfParse(buffer);
      return { type: "text", text: data.text.slice(0, MAX_TEXT_CHARS) };
    }

    if (mimeType.startsWith("text/")) {
      return { type: "text", text: buffer.toString("utf-8").slice(0, MAX_TEXT_CHARS) };
    }

    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYZE IMAGE CONTENT
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyzeImageArgs {
  /** S3/MinIO file key of the image already uploaded to the system */
  fileKey: string;
  mimeType: string;
  /** Optional: hint about what to look for (e.g. "school event", "shopping list") */
  hint?: string;
}

export interface AnalyzeImageResult {
  fileKey: string;
  /** Public URL of the file in MinIO/S3 — pass this to create_proposal as sourceFileUrl */
  publicUrl: string;
  contentType: "analyzed" | "text" | "unsupported";
  /** Text analysis of the image produced by vision model, or extracted PDF/text content */
  analysis?: string;
  instruction: string;
}

/**
 * Calls the OpenAI vision model directly to analyze an image and return a text description.
 * This avoids storing large base64 blobs in the LangGraph state.
 */
async function analyzeImageWithVision(dataUrl: string, hint?: string): Promise<string> {
  const model = new ChatOpenAI({ model: "gpt-4o-mini", maxTokens: 1500 });
  const prompt =
    `Analizá esta imagen de manera exhaustiva. Extraé TODA la información relevante que puedas ver: ` +
    `fechas, horarios, nombres de eventos, lugares, personas, productos, precios, vencimientos u otro dato importante.` +
    (hint ? `\n\nContexto: ${hint}` : "") +
    `\n\nDevolvé un análisis detallado y estructurado en español.`;
  const response = await model.invoke([
    new HumanMessage({
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    }),
  ]);
  return typeof response.content === "string" ? response.content : JSON.stringify(response.content);
}

/**
 * Analyzes an uploaded image or document file.
 * For images: calls the vision model directly and returns a text analysis (no base64 stored in state).
 * For text/PDF: extracts and returns the text content.
 */
export async function analyzeImageContentTool(
  args: AnalyzeImageArgs,
  _ctx: AgentContext,
): Promise<AnalyzeImageResult> {
  const endpoint = process.env.S3_ENDPOINT || "";
  const publicUrl = `${endpoint}/${BUCKET_NAME}/${args.fileKey}`;
  const content = await resolveFileContent(args.fileKey, args.mimeType);

  if (!content) {
    return {
      fileKey: args.fileKey,
      publicUrl,
      contentType: "unsupported",
      instruction:
        "Tipo de archivo no soportado para análisis automático. Pedile al usuario que describa el contenido.",
    };
  }

  if (content.type === "image_base64") {
    const analysis = await analyzeImageWithVision(content.dataUrl, args.hint);
    return {
      fileKey: args.fileKey,
      publicUrl,
      contentType: "analyzed",
      analysis,
      instruction:
        "Imagen analizada. Usá el campo 'analysis' para extraer todos los candidatos estructurados (fechas, eventos, productos, avisos). Para cada uno, indicá tipo, datos y nivel de confianza (0–1). Guardá el valor de `publicUrl` y pasáselo como `sourceFileUrl` en cada `create_proposal` que derives de esta imagen.",
    };
  }

  return {
    fileKey: args.fileKey,
    publicUrl,
    contentType: "text",
    analysis: content.text,
    instruction:
      "Texto extraído del documento. Analizá el campo 'analysis' y extraé todos los candidatos estructurados (fechas, eventos, productos, avisos). Para cada uno, indicá tipo, datos y nivel de confianza (0–1). Guardá el valor de `publicUrl` y pasáselo como `sourceFileUrl` en cada `create_proposal` que derives de este documento.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE PDF DOCUMENT (desde Document guardado en DB)
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsePdfDocumentArgs {
  /** ID del Document guardado en la tabla Document */
  documentId: string;
}

export interface ParsePdfDocumentResult {
  documentId: string;
  title: string;
  text?: string;
  mimeType: string;
  dataUrl?: string;
  contentType: "text" | "image_base64" | "unsupported";
  instruction: string;
}

/**
 * Loads a Document record from the DB and resolves its file content
 * so the inbox agent can extract InboxCandidate[] from it.
 */
export async function parsePdfDocumentTool(
  args: ParsePdfDocumentArgs,
  ctx: AgentContext,
): Promise<ParsePdfDocumentResult> {
  const doc = await prisma.document.findFirst({
    where: { id: args.documentId, householdId: ctx.householdId },
    select: { id: true, title: true, fileKey: true, mimeType: true },
  });

  if (!doc) {
    return {
      documentId: args.documentId,
      title: "Desconocido",
      mimeType: "",
      contentType: "unsupported",
      instruction: `Documento con ID "${args.documentId}" no encontrado en este hogar.`,
    };
  }

  const content = await resolveFileContent(doc.fileKey, doc.mimeType);

  if (!content) {
    return {
      documentId: doc.id,
      title: doc.title,
      mimeType: doc.mimeType,
      contentType: "unsupported",
      instruction: `No se pudo procesar el archivo "${doc.title}". Tipo: ${doc.mimeType}.`,
    };
  }

  if (content.type === "image_base64") {
    return {
      documentId: doc.id,
      title: doc.title,
      mimeType: doc.mimeType,
      contentType: "image_base64",
      dataUrl: content.dataUrl,
      instruction: `Imagen del documento "${doc.title}" lista. Extraé todos los candidatos: eventos, productos, avisos, vencimientos.`,
    };
  }

  return {
    documentId: doc.id,
    title: doc.title,
    mimeType: doc.mimeType,
    contentType: "text",
    text: content.text,
    instruction: `Texto del documento "${doc.title}" listo. Extraé todos los candidatos: eventos, productos, avisos, vencimientos.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST DOCUMENTS (para que inbox pueda buscar documentos del hogar)
// ─────────────────────────────────────────────────────────────────────────────

export async function listDocumentsForInboxTool(args: { memberId?: string }, ctx: AgentContext) {
  const documents = await prisma.document.findMany({
    where: {
      householdId: ctx.householdId,
      ...(args.memberId ? { OR: [{ memberId: args.memberId }, { memberId: null }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      mimeType: true,
      subject: true,
      source: true,
      createdAt: true,
      member: { select: { id: true, name: true } },
    },
  });

  return {
    total: documents.length,
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      mimeType: d.mimeType,
      subject: d.subject ?? null,
      source: d.source,
      createdAt: d.createdAt.toISOString(),
      member: d.member ? { id: d.member.id, name: d.member.name } : null,
    })),
  };
}
