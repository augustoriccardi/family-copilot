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
import { NOTIFICATIONS_AGENT_PROMPT } from "../prompts/notification";
import { resolveHouseholdId } from "../../tools/family/index";
import { createReminderTool } from "../../tools/reminders/index";
import { sendWhatsAppMessage } from "../../whatsapp/whatsapp-service";
import prisma from "../../database/prisma";

const NO_HOUSEHOLD = JSON.stringify({
  error:
    "No hay hogar configurado. Para usar funciones familiares, primero creá un hogar desde la interfaz web.",
});

function buildNotificationsTools(householdId: string | null) {
  const noHousehold = !householdId;
  const ctx = { householdId: householdId ?? "" };

  return [
    new DynamicStructuredTool({
      name: "send_whatsapp",
      description:
        "Envía un mensaje de WhatsApp a un número de teléfono específico (E.164, ej: '59891234567').",
      schema: z.object({
        to: z.string().describe("Número de teléfono E.164, ej: '59891234567'"),
        message: z.string().describe("Contenido del mensaje"),
      }),
      func: async (args) => {
        try {
          await sendWhatsAppMessage(args.to, args.message);
          return JSON.stringify({ sent: true, to: args.to });
        } catch (e) {
          return JSON.stringify({ sent: false, error: (e as Error).message });
        }
      },
    }),

    new DynamicStructuredTool({
      name: "send_whatsapp_to_member",
      description:
        "Busca el número de WhatsApp de un integrante del hogar por su ID y le envía un mensaje. Si no tiene número configurado, informa el error.",
      schema: z.object({
        memberId: z.string().describe("ID del integrante del hogar"),
        message: z.string().describe("Contenido del mensaje"),
      }),
      func: async (args) => {
        if (noHousehold) return NO_HOUSEHOLD;
        const member = await prisma.familyMember.findFirst({
          where: { id: args.memberId, householdId: ctx.householdId },
          select: { name: true, whatsappPhone: true },
        });
        if (!member) return JSON.stringify({ error: "Integrante no encontrado." });
        if (!member.whatsappPhone) {
          return JSON.stringify({
            error: `${member.name} no tiene número de WhatsApp configurado.`,
          });
        }
        try {
          await sendWhatsAppMessage(member.whatsappPhone, args.message);
          return JSON.stringify({ sent: true, to: member.name, phone: member.whatsappPhone });
        } catch (e) {
          return JSON.stringify({ sent: false, error: (e as Error).message });
        }
      },
    }),

    new DynamicStructuredTool({
      name: "send_whatsapp_to_all_members",
      description:
        "Envía un mensaje de WhatsApp a todos los integrantes del hogar que tengan número de teléfono configurado.",
      schema: z.object({
        message: z.string().describe("Contenido del mensaje a enviar"),
      }),
      func: async (args) => {
        if (noHousehold) return NO_HOUSEHOLD;
        const members = await prisma.familyMember.findMany({
          where: { householdId: ctx.householdId, whatsappPhone: { not: null } },
          select: { name: true, whatsappPhone: true },
        });
        if (members.length === 0) {
          return JSON.stringify({
            error: "Ningún integrante del hogar tiene número de WhatsApp configurado.",
          });
        }
        const results = await Promise.allSettled(
          members.map(async (m) => {
            await sendWhatsAppMessage(m.whatsappPhone!, args.message);
            return m.name;
          }),
        );
        const sent = results
          .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
          .map((r) => r.value);
        const failed = results
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((_, i) => members[i].name);
        return JSON.stringify({ sent, failed });
      },
    }),

    new DynamicStructuredTool({
      name: "create_reminder",
      description:
        "Crea un recordatorio para un integrante del hogar o para toda la familia, con título, descripción y fecha/hora.",
      schema: z.object({
        title: z.string().describe("Título del recordatorio"),
        description: z.string().optional().describe("Descripción adicional o cuerpo del mensaje"),
        dueAt: z.string().describe("Fecha y hora de vencimiento en formato ISO 8601"),
        memberId: z.string().optional().describe("ID del integrante al que aplica (opcional)"),
      }),
      func: async (args) =>
        noHousehold ? NO_HOUSEHOLD : JSON.stringify(await createReminderTool(args, ctx)),
    }),
  ];
}

export async function buildNotificationsAgent(householdId?: string, cfg?: AgentConfigOptions) {
  const resolvedId = await resolveHouseholdId(householdId);
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1 });

  return new AgentBuilder({
    llm,
    tools: buildNotificationsTools(resolvedId),
    prompt: NOTIFICATIONS_AGENT_PROMPT(),
    checkpointer: postgresCheckpointer,
    approveAllTools: true,
  }).build();
}
