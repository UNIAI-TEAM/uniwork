/** Public feature URLs are stable and deliberately separate from demo hashes. */
export const FEATURE_PAGE_KEYS = ["dashboard", "tasks", "projects", "today", "calendar", "workflows", "meetings", "chat", "email", "outputs", "documents", "approvals", "knowledge", "ask", "agents", "automation", "organization", "audit", "ai-brain", "skills", "work-catalog", "decisions", "decision-history", "ai-market", "reports"] as const;
export type FeaturePageKey = typeof FEATURE_PAGE_KEYS[number];
export function isFeaturePageKey(value: string): value is FeaturePageKey {
  return FEATURE_PAGE_KEYS.some(key => key === value);
}

const REFERENCE_COPY = new Set<string>(["calendar", "workflows", "outputs", "documents", "approvals", "knowledge", "agents", "automation", "ai-brain", "skills", "work-catalog", "decisions", "decision-history", "ai-market", "reports"]);
/** Product storytelling follows the approved reference, not a release checklist. */
export function featureCopyPrefix(key: FeaturePageKey) {
  return `${REFERENCE_COPY.has(key) ? "landing.revision.features" : "landing.productPages.features"}.${key}`;
}

export function previewKind(key: FeaturePageKey) {
  return ["tasks", "meetings", "chat", "email", "ask"].includes(key) ? "interactive" : "illustration";
}
