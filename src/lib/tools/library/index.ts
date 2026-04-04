import pdfParse from "pdf-parse";
import prisma from "@/lib/database/prisma";
import { getFile } from "@/lib/storage/upload";

const MAX_TEXT_CHARS = 80_000;

export interface AgentContext {
  householdId: string;
  callerId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTAR DOCUMENTOS
// ─────────────────────────────────────────────────────────────────────────────

export async function listDocumentsTool(args: { memberId?: string }, ctx: AgentContext) {
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

// ─────────────────────────────────────────────────────────────────────────────
// OBTENER TEXTO DE UN DOCUMENTO (descarga desde MinIO y extrae texto)
// ─────────────────────────────────────────────────────────────────────────────

async function getDocumentText(documentId: string, householdId: string): Promise<string | null> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, householdId },
    select: { fileKey: true, mimeType: true, title: true },
  });

  if (!doc) return null;

  try {
    const buffer = await getFile(doc.fileKey);

    // For text/markdown files, return raw text
    if (doc.mimeType.startsWith("text/")) {
      return buffer.toString("utf-8").slice(0, MAX_TEXT_CHARS);
    }

    // For PDFs, extract plain text with pdf-parse
    if (doc.mimeType === "application/pdf") {
      const data = await pdfParse(buffer);
      return data.text.slice(0, MAX_TEXT_CHARS);
    }

    // For images, return base64 (small files only)
    if (doc.mimeType.startsWith("image/")) {
      return `data:${doc.mimeType};base64,${buffer.toString("base64")}`;
    }

    return buffer.toString("utf-8").slice(0, MAX_TEXT_CHARS);
  } catch (err) {
    console.error("[getDocumentText] error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTAR DOCUMENTO
// ─────────────────────────────────────────────────────────────────────────────

export async function queryDocumentTool(
  args: { documentId: string; question: string },
  ctx: AgentContext,
) {
  const doc = await prisma.document.findFirst({
    where: { id: args.documentId, householdId: ctx.householdId },
    select: { id: true, title: true, mimeType: true, fileKey: true, subject: true },
  });

  if (!doc) {
    return { error: `Documento con ID "${args.documentId}" no encontrado en este hogar.` };
  }

  const content = await getDocumentText(args.documentId, ctx.householdId);
  if (!content) {
    return { error: `No se pudo leer el contenido del documento "${doc.title}".` };
  }

  return {
    documentId: doc.id,
    title: doc.title,
    subject: doc.subject ?? null,
    mimeType: doc.mimeType,
    question: args.question,
    content,
    instruction:
      "El campo 'content' contiene el documento completo (texto o base64). Respondé la pregunta basándote en él.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESUMIR DOCUMENTO
// ─────────────────────────────────────────────────────────────────────────────

export async function summarizeDocumentTool(args: { documentId: string }, ctx: AgentContext) {
  const doc = await prisma.document.findFirst({
    where: { id: args.documentId, householdId: ctx.householdId },
    select: { id: true, title: true, mimeType: true, subject: true, fileKey: true },
  });

  if (!doc) {
    return { error: `Documento con ID "${args.documentId}" no encontrado en este hogar.` };
  }

  const content = await getDocumentText(args.documentId, ctx.householdId);
  if (!content) {
    return { error: `No se pudo leer el contenido del documento "${doc.title}".` };
  }

  return {
    documentId: doc.id,
    title: doc.title,
    subject: doc.subject ?? null,
    mimeType: doc.mimeType,
    content,
    instruction:
      "El campo 'content' contiene el documento completo. Hacé un resumen claro y estructurado.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEXAR DOCUMENTO (registra metadata; el contenido ya está en MinIO vía upload)
// ─────────────────────────────────────────────────────────────────────────────

export async function indexDocumentTool(
  args: {
    title: string;
    fileUrl: string;
    fileKey: string;
    mimeType: string;
    memberId?: string;
    subject?: string;
    source?: string;
  },
  ctx: AgentContext,
) {
  // Validate memberId if provided
  if (args.memberId) {
    const member = await prisma.familyMember.findFirst({
      where: { id: args.memberId, householdId: ctx.householdId },
      select: { id: true },
    });
    if (!member) {
      return { error: `Miembro con ID "${args.memberId}" no encontrado en este hogar.` };
    }
  }

  const doc = await prisma.document.create({
    data: {
      householdId: ctx.householdId,
      memberId: args.memberId ?? null,
      title: args.title,
      fileUrl: args.fileUrl,
      fileKey: args.fileKey,
      mimeType: args.mimeType,
      subject: args.subject ?? null,
      source: args.source ?? "manual",
    },
  });

  return {
    success: true,
    documentId: doc.id,
    title: doc.title,
    message: `Documento "${doc.title}" indexado correctamente.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERAR EJERCICIOS
// ─────────────────────────────────────────────────────────────────────────────

export async function generateExercisesTool(
  args: {
    topic: string;
    count?: number;
    difficulty?: "easy" | "medium" | "hard";
    /** Edad del alumno — el agente ajusta el lenguaje */
    age?: number;
    /** Si se pasa, el agente extrae contexto del documento antes de generar */
    documentId?: string;
    subject?: string;
  },
  ctx: AgentContext,
) {
  let documentContent: string | null = null;

  if (args.documentId) {
    documentContent = await getDocumentText(args.documentId, ctx.householdId);
  }

  return {
    topic: args.topic,
    count: args.count ?? 5,
    difficulty: args.difficulty ?? "medium",
    age: args.age ?? null,
    subject: args.subject ?? null,
    documentContent,
    instruction:
      "Generá exactamente `count` ejercicios sobre `topic` con nivel `difficulty`. " +
      "Si `age` está presente, adaptá el lenguaje y complejidad a esa edad. " +
      "Si `documentContent` está presente, basá los ejercicios en ese contenido. " +
      "Devolvé los ejercicios numerados con enunciado claro. Al final incluí las respuestas en una sección separada.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERAR QUIZ
// ─────────────────────────────────────────────────────────────────────────────

export async function generateQuizTool(
  args: {
    /** ID del documento fuente (requerido o topic requerido) */
    documentId?: string;
    topic?: string;
    count?: number;
    difficulty?: "easy" | "medium" | "hard";
    age?: number;
  },
  ctx: AgentContext,
) {
  if (!args.documentId && !args.topic) {
    return { error: "Debés proporcionar documentId o topic para generar un quiz." };
  }

  let documentContent: string | null = null;
  let documentTitle: string | null = null;

  if (args.documentId) {
    const doc = await prisma.document.findFirst({
      where: { id: args.documentId, householdId: ctx.householdId },
      select: { title: true },
    });
    if (!doc) return { error: `Documento con ID "${args.documentId}" no encontrado.` };
    documentTitle = doc.title;
    documentContent = await getDocumentText(args.documentId, ctx.householdId);
    if (!documentContent) return { error: `No se pudo leer el contenido del documento.` };
  }

  return {
    documentId: args.documentId ?? null,
    documentTitle,
    topic: args.topic ?? null,
    count: args.count ?? 5,
    difficulty: args.difficulty ?? "medium",
    age: args.age ?? null,
    documentContent,
    instruction:
      "Generá un quiz de opción múltiple con exactamente `count` preguntas. " +
      "Cada pregunta debe tener 4 opciones (A, B, C, D) con una sola respuesta correcta. " +
      "Si `age` está presente, adaptá el lenguaje. " +
      "Si `documentContent` está presente, las preguntas deben surgir de ese contenido. " +
      "Formato: numerá las preguntas, listá opciones con letra. Al final listá las respuestas correctas.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPLICAR CONCEPTO
// ─────────────────────────────────────────────────────────────────────────────

export async function explainConceptTool(
  args: {
    concept: string;
    age?: number;
    subject?: string;
    /** Si se pasa, el agente busca el concepto dentro del documento antes de explicar */
    documentId?: string;
  },
  ctx: AgentContext,
) {
  let documentContent: string | null = null;

  if (args.documentId) {
    documentContent = await getDocumentText(args.documentId, ctx.householdId);
  }

  return {
    concept: args.concept,
    age: args.age ?? null,
    subject: args.subject ?? null,
    documentContent,
    instruction:
      "Explicá `concept` de forma clara y accesible. " +
      "Si `age` está presente, adaptá el lenguaje a esa edad (ej: 8 años → analogías simples; 16 años → mayor profundidad). " +
      "Si `documentContent` está presente, priorizá la explicación basada en ese material. " +
      "Incluí un ejemplo concreto al final.",
  };
}
