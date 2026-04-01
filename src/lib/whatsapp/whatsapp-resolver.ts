/**
 * Resolves which Household (and threadId) to use for an incoming WhatsApp message.
 *
 * Lookup order:
 * 1. FamilyMember.whatsappPhone matches the sender → use member's Household
 * 2. First household in DB (single-household / personal use fallback)
 * 3. Returns null if no household exists → caller should trigger onboarding
 *
 * Thread ID convention: "wa-<e164phone>" — one persistent thread per phone number.
 */

import prisma from "@/lib/database/prisma";

export interface WhatsAppIdentity {
  householdId: string;
  threadId: string;
  /** Display name to greet the user — member name or household name */
  displayName: string;
  /** True when this is the very first contact (household just created) */
  isNewHousehold?: boolean;
}

/**
 * Normalises a WhatsApp "from" number to E.164 format (digits only, no +).
 * Meta sends numbers like "5491123456789" (already without +).
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Resolves the household and conversation thread for an incoming WhatsApp message.
 * Returns null when no household exists in the database.
 */
export async function resolveWhatsAppIdentity(rawPhone: string): Promise<WhatsAppIdentity | null> {
  const phone = normalizePhone(rawPhone);
  const threadId = `wa-${phone}`;

  // 1. Look for a FamilyMember whose whatsappPhone matches
  const member = await prisma.familyMember.findFirst({
    where: {
      whatsappPhone: { contains: phone },
    },
    select: {
      id: true,
      name: true,
      householdId: true,
      household: { select: { id: true, name: true } },
    },
  });

  if (member) {
    return {
      householdId: member.householdId,
      threadId,
      displayName: member.name,
    };
  }

  // 2. Fallback: first household in DB
  const household = await prisma.household.findFirst({
    select: { id: true, name: true },
  });

  if (household) {
    return {
      householdId: household.id,
      threadId,
      displayName: household.name,
    };
  }

  // 3. No household found — caller must handle onboarding
  return null;
}

/**
 * Auto-provisions a new Household and FamilyMember for a first-time WhatsApp user.
 * Called when no household exists in the database.
 */
export async function provisionNewHousehold(rawPhone: string): Promise<WhatsAppIdentity> {
  const phone = normalizePhone(rawPhone);
  const threadId = `wa-${phone}`;

  const household = await prisma.household.create({
    data: {
      name: "Mi familia",
      members: {
        create: {
          name: "Administrador",
          role: "PADRE",
          whatsappPhone: phone,
        },
      },
    },
    select: { id: true, name: true },
  });

  return {
    householdId: household.id,
    threadId,
    displayName: household.name,
    isNewHousehold: true,
  };
}
