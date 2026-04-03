# Auth Migration Guide

How to replace the current "selector manual" identity system with real authentication.

---

## Current state (no auth)

### Web channel

Identity comes from the UI member selector in `SettingsPanel` → persisted in `localStorage` → sent as query params `callerId / callerName / callerRole` on each SSE request.

**Resolved in**: `src/lib/identity/web-identity.ts` → `resolveWebIdentity()`

### WhatsApp channel

Identity comes from `FamilyMember.whatsappPhone` matching the sender's phone number.

**Resolved in**: `src/lib/whatsapp/whatsapp-resolver.ts` → `resolveWhatsAppIdentity()`

---

## Target state (with auth)

```
User logs in (NextAuth / Clerk)
  → session.user.id  →  User.id  →  FamilyMember.linkedUserId
  → resolved callerId / callerName / callerRole
```

The schema is already prepared:

- `User` model exists in `prisma/schema.prisma`
- `FamilyMember.linkedUserId` nullable FK → `User`
- `CalendarConnection.userId` nullable FK → `User`

---

## Migration steps

### 1. Install auth provider

```bash
# NextAuth v5
pnpm add next-auth@beta

# or Clerk
pnpm add @clerk/nextjs
```

### 2. Create auth config

NextAuth example (`src/lib/auth/config.ts`):

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    session({ session, token }) {
      session.user.id = token.sub!;
      return session;
    },
  },
});
```

### 3. Add login flow + link FamilyMember

When a user logs in for the first time, link their `User` record to the right `FamilyMember`:

```ts
// After OAuth callback — one-time setup per user
await prisma.familyMember.update({
  where: { id: selectedMemberId }, // member they select during onboarding
  data: { linkedUserId: session.user.id },
});
```

### 4. Replace `resolveWebIdentity()` — **ONLY file to change**

File: `src/lib/identity/web-identity.ts`

Replace the TODO block:

```ts
// BEFORE (current — manual selector):
const callerId = searchParams.get("callerId") || undefined;
const callerName = searchParams.get("callerName") || undefined;
const callerRole = searchParams.get("callerRole") || undefined;

// AFTER (NextAuth):
import { auth } from "@/lib/auth/config";

const session = await auth();
let callerId: string | undefined;
let callerName: string | undefined;
let callerRole: string | undefined;

if (session?.user?.id) {
  const member = await prisma.familyMember.findFirst({
    where: { linkedUserId: session.user.id },
    select: { id: true, name: true, role: true, householdId: true },
  });
  if (member) {
    callerId = member.id;
    callerName = member.name;
    callerRole = member.role;
    // Override householdId from session instead of thread lookup:
    householdId = member.householdId;
  }
}
```

> Everything downstream (stream route, agentService, supervisor prompt, subagents)
> consumes the same `{ callerId, callerName, callerRole, householdId }` shape —
> **no other file needs to change**.

### 5. Remove the UI selector (optional cleanup)

Once auth is working:

- Remove the `¿Quién sos?` select from `SettingsPanel`
- Remove `callerId / callerName / callerRole` query params from `chatService.ts`
- Remove `caller` state from `UISettingsContext`
- Remove the `CALLER_STORAGE_KEY` localStorage entry

The `callerId` still flows into the agent via the session — the UI just no longer drives it.

### 6. WhatsApp channel (no change needed)

`resolveWhatsAppIdentity()` already resolves the member from the phone number.
If you want to verify the phone is linked to a `User`, add an optional check:

```ts
// Optional: verify phone matches a User record
if (member && member.linkedUserId) {
  // Phone is linked to an authenticated user — can enforce stricter policies
}
```

---

## Files touched in total

| File                                      | Change                                       |
| ----------------------------------------- | -------------------------------------------- |
| `src/lib/identity/web-identity.ts`        | Replace TODO block with `getServerSession()` |
| `src/lib/auth/config.ts`                  | **New file** — auth provider config          |
| `src/app/api/auth/[...nextauth]/route.ts` | **New file** — NextAuth route handler        |
| `src/components/SettingsPanel.tsx`        | Remove member selector (cleanup)             |
| `src/contexts/UISettingsContext.tsx`      | Remove caller state (cleanup)                |
| `src/services/chatService.ts`             | Remove caller query params (cleanup)         |

**Not touched**: stream route, agentService, supervisor prompt, subagents, WhatsApp agent.

---

## Schema changes needed

None — `User`, `FamilyMember.linkedUserId`, and `CalendarConnection.userId` are already in the schema. Just populate them.

If using NextAuth with a database adapter, add the NextAuth tables via migration:

```bash
pnpm prisma migrate dev --name add-nextauth-tables
```

Or use NextAuth's built-in Prisma adapter which handles this automatically.
