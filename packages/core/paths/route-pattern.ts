import { isGlobalPath } from "./paths";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Collapse a pathname into the route pattern RUM reports on (F-11 §2.8), so
 * the metric label never carries a tenant slug or an id:
 * `/acme/team/tasks/01ARZ…` → `/[orgSlug]/[workspaceSlug]/tasks/:id`.
 * Global paths (auth, invite, admin) keep their segments, ids replaced.
 */
export function routePattern(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean).map((s) => (ULID.test(s) ? ":id" : s));
  if (segments.length === 0) return "/";
  const path = "/" + segments.join("/");
  if (isGlobalPath(path) || segments.length < 2) return path;
  return "/[orgSlug]/[workspaceSlug]" + (segments.length > 2 ? "/" + segments.slice(2).join("/") : "");
}
