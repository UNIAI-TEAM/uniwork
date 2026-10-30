import type { Plan } from "@uniwork/core/types/billing";

export const PRICING_QUOTA_KEYS = [
  "members.max", "workspaces.max", "tasks.max", "storage.bytes",
  "meeting.participant_minutes", "meeting.transcription", "ai.tokens",
] as const;

// Each flag has a runtime entitlement gate. The catalog-only SSO flag is not evidence of a tier-specific runtime entitlement.
const COMPARISON_FEATURES = [
  "meeting.recording", "meeting.ai_summary", "documents.public_links", "office.ai_cloud",
] as const;

/** A standalone table needs several real differences; common, missing and unwired flags add no comparison value. */
export function pricingComparisonRows(plans: readonly Pick<Plan, "features">[]): string[] {
  if (plans.length < 2) return [];
  const rows = COMPARISON_FEATURES.filter(key => {
    const declarations = plans.map(plan => plan.features.find(feature => feature.feature_key === key));
    return declarations.every(feature => feature !== undefined)
      && declarations.some(feature => feature?.enabled !== declarations[0]?.enabled);
  });
  return rows.length >= 3 ? rows : [];
}
