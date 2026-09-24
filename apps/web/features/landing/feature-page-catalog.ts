/** Public feature URLs are stable and deliberately separate from demo hashes. */
export const FEATURE_PAGE_KEYS = ["dashboard", "tasks", "projects", "today", "calendar", "workflows", "meetings", "chat", "email", "outputs", "documents", "approvals", "knowledge", "ask", "agents", "automation", "organization", "audit"] as const;
export type FeaturePageKey = typeof FEATURE_PAGE_KEYS[number];
export function isFeaturePageKey(value: string): value is FeaturePageKey {
  return FEATURE_PAGE_KEYS.some(key => key === value);
}
