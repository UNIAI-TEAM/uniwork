import type { SupportedLocale } from "../i18n/types";

/** Stable public URLs: also used by localized navigation, sitemap and metadata. */
export const MARKETING_FEATURE_KEYS = ["dashboard", "tasks", "projects", "today", "calendar", "workflows", "meetings", "chat", "email", "outputs", "documents", "approvals", "knowledge", "ask", "agents", "automation", "organization", "audit"] as const;
export const MARKETING_GUIDE_KEYS = ["start-with-tasks", "office-files-and-ai", "meetings-to-tasks"] as const;
export type MarketingGuideKey = typeof MARKETING_GUIDE_KEYS[number];
export const MARKETING_ROUTES = [
  { path: "/", key: "home" }, { path: "/office", key: "office" }, { path: "/unichat", key: "unichat" },
  { path: "/features", key: "features" },
  ...MARKETING_FEATURE_KEYS.map(key => ({ path: `/features/${key}`, key })),
  { path: "/solutions", key: "solutions" },
  { path: "/solutions/product", key: "product" }, { path: "/solutions/operations", key: "operations" },
  { path: "/learn", key: "learn" }, { path: "/why-uniwork", key: "why" },
  { path: "/pricing", key: "pricing" }, { path: "/enterprise", key: "enterprise" }, // plan-literal-ok: public route key, not a plan code
  { path: "/request-demo", key: "demo" }, { path: "/changelog", key: "changelog" },
  { path: "/about", key: "about" }, { path: "/security", key: "security" },
  ...MARKETING_GUIDE_KEYS.map(key => ({ path: `/learn/${key}`, key })),
] as const;

export function vietnamesePath(segments: readonly string[] = []): string {
  return `/vi${segments.length ? `/${segments.map(encodeURIComponent).join("/")}` : ""}`;
}

export function marketingRoute(href: string): { path: string; key: string; locale: SupportedLocale } | null {
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return null;
  const pathname = href.split(/[?#]/)[0]!.replace(/\/$/, "") || "/";
  const locale = pathname === "/vi" || pathname.startsWith("/vi/") ? "vi" : "en";
  const path = locale === "vi" ? pathname.slice(3) || "/" : pathname;
  const route = MARKETING_ROUTES.find(entry => entry.path === path);
  return route ? { ...route, locale } : null;
}

export function marketingHref(href: string, locale: SupportedLocale): string {
  const route = marketingRoute(href);
  if (!route) return href;
  const suffix = href.match(/[?#].*$/)?.[0] ?? "";
  return `${locale === "vi" ? `/vi${route.path === "/" ? "" : route.path}` : route.path}${suffix}`;
}
