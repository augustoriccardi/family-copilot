import pdfParse from "pdf-parse";
import prisma from "@/lib/database/prisma";
import { getFile } from "@/lib/storage/upload";
import type { EventCandidate, ProductIntentItem, InboxCandidate } from "@/types/agent-contracts";

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
  contentType: "image_base64" | "text" | "unsupported";
  /**
   * For image_base64: pass dataUrl to the LLM via a vision message.
   * For text: the extracted text ready for the LLM to analyze.
   */
  dataUrl?: string;
  text?: string;
  hint?: string;
  instruction: string;
}

/**
 * Resolves an uploaded image file to base64 so the calling LLM agent
 * can include it in a vision prompt and extract InboxCandidate[] from it.
 *
 * NOTE: This tool does NOT call the LLM — it prepares the data.
 * The inbox agent LLM then receives the image and extracts candidates.
 */
export async function analyzeImageContentTool(
  args: AnalyzeImageArgs,
  _ctx: AgentContext,
): Promise<AnalyzeImageResult> {
  const content = await resolveFileContent(args.fileKey, args.mimeType);

  if (!content) {
    return {
      fileKey: args.fileKey,
      contentType: "unsupported",
      instruction:
        "Tipo de archivo no soportado para análisis automático. Pedile al usuario que describa el contenido.",
    };
  }

  if (content.type === "image_base64") {
    return {
      fileKey: args.fileKey,
      contentType: "image_base64",
      dataUrl: content.dataUrl,
      hint: args.hint,
      instruction:
        "Imagen lista para analizar. Examiná el contenido y extraé todos los candidatos estructurados que encuentres (fechas, eventos, productos, avisos). Para cada uno, indicá tipo, datos y nivel de confianza (0–1).",
    };
  }

  return {
    fileKey: args.fileKey,
    contentType: "text",
    text: content.text,
    hint: args.hint,
    instruction:
      "Texto extraído del documento. Analizá el contenido y extraé todos los candidatos estructurados que encuentres (fechas, eventos, productos, avisos). Para cada uno, indicá tipo, datos y nivel de confianza (0–1).",
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
