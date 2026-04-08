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
import { sendWhatsAppMessage } from "../../whatsapp/whatsapp-service";
import { sendEmail } from "../../email/email-service";
import prisma from "../../database/prisma";

const NO_HOUSEHOLD = JSON.stringify({
  error:
    "No hay hogar configurado. Para usar funciones familiares, primero creá un hogar desde la interfaz web.",
});

function buildNotificationsTools(householdId: string | null) {
  const noHousehold = !householdId;
  const householdCtx = householdId ?? "";

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
          where: { id: args.memberId, householdId: householdCtx },
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
          where: { householdId: householdCtx, whatsappPhone: { not: null } },
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
      name: "send_email_to_member",
      description:
        "Envía un email a un integrante del hogar usando su dirección de correo registrada. Si no tiene email configurado, informa el error.",
      schema: z.object({
        memberId: z.string().describe("ID del integrante del hogar"),
        subject: z.string().describe("Asunto del email"),
        message: z.string().describe("Cuerpo del mensaje en texto plano"),
      }),
      func: async (args) => {
        if (noHousehold) return NO_HOUSEHOLD;
        const member = await prisma.familyMember.findFirst({
          where: { id: args.memberId, householdId: householdCtx },
          select: { name: true, email: true, linkedUser: { select: { email: true } } },
        });
        if (!member) return JSON.stringify({ error: "Integrante no encontrado." });
        const email = member.email ?? member.linkedUser?.email ?? null;
        if (!email) {
          return JSON.stringify({
            error: `${member.name} no tiene dirección de email configurada.`,
          });
        }
        try {
          await sendEmail({ to: email, subject: args.subject, text: args.message });
          return JSON.stringify({ sent: true, to: member.name, email });
        } catch (e) {
          return JSON.stringify({ sent: false, error: (e as Error).message });
        }
      },
    }),

    new DynamicStructuredTool({
      name: "send_email_to_all_members",
      description:
        "Envía un email a todos los integrantes del hogar que tengan dirección de correo configurada.",
      schema: z.object({
        subject: z.string().describe("Asunto del email"),
        message: z.string().describe("Cuerpo del mensaje en texto plano"),
      }),
      func: async (args) => {
        if (noHousehold) return NO_HOUSEHOLD;
        const members = await prisma.familyMember.findMany({
          where: { householdId: householdCtx },
          select: { name: true, email: true, linkedUser: { select: { email: true } } },
        });
        // Use explicit contact email; fall back to linked User's auth email
        const withEmail = members
          .map((m) => ({ name: m.name, email: m.email ?? m.linkedUser?.email ?? null }))
          .filter((m): m is { name: string; email: string } => m.email !== null);
        if (withEmail.length === 0) {
          return JSON.stringify({
            error: "Ningún integrante del hogar tiene dirección de email configurada.",
          });
        }
        const results = await Promise.allSettled(
          withEmail.map(async (m) =>
            sendEmail({ to: m.email, subject: args.subject, text: args.message }).then(
              () => m.name,
            ),
          ),
        );
        const sent = results
          .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
          .map((r) => r.value);
        const failed = results
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((_, i) => withEmail[i].name);
        return JSON.stringify({ sent, failed });
      },
    }),
  ];
}

export async function buildNotificationsAgent(householdId?: string, cfg?: AgentConfigOptions) {
  const resolvedId = await resolveHouseholdId(householdId);
  const provider = cfg?.provider || DEFAULT_MODEL_PROVIDER;
  const modelName = cfg?.model || DEFAULT_MODEL_NAME;
  const llm = createChatModel({ provider, model: modelName, temperature: 1, apiKey: cfg?.apiKey });

  return new AgentBuilder({
    llm,
    tools: buildNotificationsTools(resolvedId),
    prompt: NOTIFICATIONS_AGENT_PROMPT(),
    checkpointer: postgresCheckpointer,
    approveAllTools: true,
  }).build();
}
