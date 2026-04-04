/**
 * Shared payload contracts between agents.
 * These types define the structured messages that flow between agents via the supervisor.
 *
 * Producers and consumers:
 *   inbox    → produces EventCandidate, ProductIntentItem, InboxCandidate
 *   calendar → consumes EventCandidate; produces NotificationRequest
 *   recipe   → produces ProductIntentItem[]
 *   shopping → consumes ProductIntentItem[]
 *   reminder → consumes NotificationRequest
 *   library  → consumes StudyRequest (future agent)
 */

// ──────────────────────────────────────────────────────────────────
// inbox → calendar
// ──────────────────────────────────────────────────────────────────

export type EventCandidate = {
  title: string;
  memberId?: string;
  startAt: string; // ISO 8601
  endAt?: string; // ISO 8601
  location?: string;
  source: "email" | "web" | "pdf" | "image" | "manual";
  confidence: number; // 0–1
  requiresConfirmation: boolean;
  notes?: string;
};

// ──────────────────────────────────────────────────────────────────
// recipe / inbox / family → shopping
// ──────────────────────────────────────────────────────────────────

export type ProductIntentItem = {
  category: "grocery" | "clothing" | "school" | "home" | "pharmacy";
  canonicalName: string;
  quantity: number;
  unit: "unit" | "kg" | "g" | "l" | "ml" | "pack";
  memberId?: string;
  preferredBrands?: string[];
  substitutesAllowed: boolean;
  notes?: string;
};

// ──────────────────────────────────────────────────────────────────
// calendar → reminder
// ──────────────────────────────────────────────────────────────────

export type NotificationRequest = {
  type: "reminder" | "digest" | "urgent";
  targetMembers: string[];
  title: string;
  message: string;
  sendAt: string; // ISO 8601
  channels: ("push" | "email" | "whatsapp")[];
  eventId?: string;
};

// ──────────────────────────────────────────────────────────────────
// supervisor → library (future agent)
// ──────────────────────────────────────────────────────────────────

export type StudyRequest = {
  memberId: string;
  subject?: string;
  goal: "explain" | "quiz" | "exercise" | "summary" | "search";
  age?: number;
  sourceDocumentIds?: string[];
  difficulty?: "easy" | "medium" | "hard";
  freeText?: string;
};

// ──────────────────────────────────────────────────────────────────
// inbox output union (all candidates produced by inbox agent)
// ──────────────────────────────────────────────────────────────────

export type DocumentReference = {
  title: string;
  memberId?: string;
  fileUrl: string;
  mimeType: string;
  source: string;
};

export type PaymentDeadline = {
  description: string;
  amount?: number;
  currency?: string;
  dueAt: string; // ISO 8601
  memberId?: string;
  source: string;
};

export type SchoolNotice = {
  title: string;
  body: string;
  memberId?: string;
  schoolName?: string;
  relevantDate?: string; // ISO 8601
  source: string;
  requiresAction: boolean;
};

export type InboxCandidate =
  | { type: "event_candidate"; data: EventCandidate }
  | { type: "shopping_item_candidate"; data: ProductIntentItem }
  | { type: "document_to_index"; data: DocumentReference }
  | { type: "payment_deadline"; data: PaymentDeadline }
  | { type: "school_notice"; data: SchoolNotice };
