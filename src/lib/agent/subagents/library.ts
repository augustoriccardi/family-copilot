import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentBuilder } from "../builder";
import { postgresCheckpointer } from "../memory";
import {
  AgentConfigOptions,
  createChatModel,
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
} from "../util";
import { LIBRARY_AGENT_PROMPT } from "../prompts/library";
import { CallerInfo } from "../prompts/supervisor";
import {
  listDocumentsTool,
  queryDocumentTool,
  summarizeDocumentTool,
  indexDocumentTool,
  generateExercisesTool,
  generateQuizTool,
  explainConceptTool,
} from "../../tools/library/index";

const NO_HOUSEHOLD = JSON.stringify({
  error:
    "No hay hogar configurado. Para usar funciones familiares, primero creá un hogar desde la interfaz web.",
});

function buildLibraryTools(householdId: string | null) {
  const noHousehold = !householdId;
  const ctx = { householdId: householdId ?? "" };

  return [
    new DynamicStructuredTool({
      name: "list_documents",
      description:
        "Lista todos los documentos indexados del hogar. Opcionalmente filtrá por miembro. Usá esto para encontrar el ID de un documento antes de consultarlo.",
      schema: z.object({
        memberId: z
          .string()
          .optional()
          .describe("ID del miembro para filtrar (opcional). Si se omite, lista todos."),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await listDocumentsTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "query_document",
      description:
        "Obtiene el contenido completo de un documento y formula la pregunta del usuario. El tool devuelve el texto o base64 del documento para que puedas responder directamente.",
      schema: z.object({
        documentId: z.string().describe("ID del documento a consultar"),
        question: z.string().describe("Pregunta del usuario sobre el documento"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await queryDocumentTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "summarize_document",
      description: "Obtiene el contenido completo de un documento para resumirlo.",
      schema: z.object({
        documentId: z.string().describe("ID del documento a resumir"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await summarizeDocumentTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "index_document",
      description:
        "Registra un documento ya subido a MinIO/S3 en la base de datos del hogar. Usá esto cuando el usuario quiera guardar un documento para consulta futura.",
      schema: z.object({
        title: z.string().describe("Título del documento"),
        fileUrl: z.string().describe("URL pública del archivo en MinIO/S3"),
        fileKey: z.string().describe("Key del archivo en el bucket S3"),
        mimeType: z.string().describe("Tipo MIME del archivo (ej: application/pdf, image/jpeg)"),
        memberId: z
          .string()
          .optional()
          .describe("ID del miembro al que pertenece (opcional, si es de todo el hogar omitir)"),
        subject: z
          .string()
          .optional()
          .describe("Materia o tema del documento (ej: matemáticas, ciencias)"),
        source: z
          .string()
          .optional()
          .describe("Origen del documento: manual, inbox, email, whatsapp"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await indexDocumentTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "generate_exercises",
      description:
        "Genera ejercicios sobre un tema o basados en un documento indexado. Adaptá la dificultad y el lenguaje según la edad del alumno.",
      schema: z.object({
        topic: z.string().describe("Tema sobre el que generar los ejercicios"),
        count: z.number().optional().describe("Cantidad de ejercicios (por defecto 5)"),
        difficulty: z
          .enum(["easy", "medium", "hard"])
          .optional()
          .describe("Dificultad: easy | medium | hard"),
        age: z.number().optional().describe("Edad del alumno para adaptar el lenguaje"),
        documentId: z
          .string()
          .optional()
          .describe(
            "ID del documento fuente (opcional — si se pasa, los ejercicios se basan en él)",
          ),
        subject: z.string().optional().describe("Materia (ej: matemáticas, biología)"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await generateExercisesTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "generate_quiz",
      description:
        "Genera un quiz de opción múltiple sobre un documento indexado o sobre un tema. Cada pregunta tiene 4 opciones (A-D) con una respuesta correcta.",
      schema: z.object({
        documentId: z
          .string()
          .optional()
          .describe("ID del documento fuente. Requerido si no se pasa topic."),
        topic: z.string().optional().describe("Tema del quiz. Requerido si no se pasa documentId."),
        count: z.number().optional().describe("Cantidad de preguntas (por defecto 5)"),
        difficulty: z.enum(["easy", "medium", "hard"]).optional().describe("Dificultad"),
        age: z.number().optional().describe("Edad del alumno para adaptar nivel"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await generateQuizTool(args, ctx)),
    }),

    new DynamicStructuredTool({
      name: "explain_concept",
      description:
        "Explica un concepto de forma clara, adaptada a la edad del alumno. Si se pasa un documentId, la explicación se basa en ese material.",
      schema: z.object({
        concept: z.string().describe("Concepto a explicar"),
        age: z.number().optional().describe("Edad del alumno"),
        subject: z.string().optional().describe("Materia o contexto"),
        documentId: z
          .string()
          .optional()
          .describe("ID del documento donde buscar el concepto (opcional)"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await explainConceptTool(args, ctx)),
    }),
  ];
}

/**
 * Builds and returns the compiled Library subagent graph.
 * Handles document Q&A, summarization, indexing and educational support.
 */
export function buildLibraryAgent(
  householdId: string | null,
  cfg?: AgentConfigOptions,
  caller?: CallerInfo,
) {
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1, apiKey: cfg?.apiKey });

  const libraryTools = buildLibraryTools(householdId);

  return new AgentBuilder({
    llm,
    tools: libraryTools,
    prompt: LIBRARY_AGENT_PROMPT(caller),
    checkpointer: postgresCheckpointer,
    approveAllTools: true,
  }).build();
}
