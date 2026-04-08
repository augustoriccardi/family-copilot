/**
 * Rules engine for automation side effects.
 *
 * Rules are evaluated per event type. When a condition matches,
 * the corresponding action is queued.
 *
 * For MVP, rules live in code. When per-household configuration is needed,
 * read from HouseholdPreferences.automationRules without changing this interface.
 */

export type RuleAction = "create_reminder" | "send_notification" | "noop";

export interface Rule {
  condition: (payload: Record<string, unknown>) => boolean;
  action: RuleAction;
  /** Builds the action params from the event payload */
  params: (payload: Record<string, unknown>) => Record<string, unknown>;
}

export const RULES: Record<string, Rule[]> = {
  "event.created": [
    // Always create a 30-minute reminder for any event with a start time
    {
      condition: (p) => !!p.startsAt,
      action: "create_reminder",
      params: (p) => ({
        eventId: p.eventId,
        memberId: p.memberId,
        householdId: p.householdId,
        title: `⏰ Recordatorio: ${p.title ?? "Evento próximo"}`,
        minutesBefore: 30,
      }),
    },
    // Also create a 24-hour reminder for medical events
    {
      condition: (p) => p.eventType === "MEDICAL" && !!p.startsAt,
      action: "create_reminder",
      params: (p) => ({
        eventId: p.eventId,
        memberId: p.memberId,
        householdId: p.householdId,
        title: `🏥 Turno mañana: ${p.title ?? "Consulta médica"}`,
        minutesBefore: 1440,
      }),
    },
  ],
};

export function evaluateRules(
  eventType: string,
  payload: Record<string, unknown>,
): Array<{ action: RuleAction; params: Record<string, unknown> }> {
  const rules = RULES[eventType] ?? [];
  return rules
    .filter((rule) => rule.condition(payload))
    .map((rule) => ({ action: rule.action, params: rule.params(payload) }));
}
