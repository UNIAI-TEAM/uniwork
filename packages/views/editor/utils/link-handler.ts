/**
 * Shared link handling utilities for the editor system.
 *
 * Used by content-editor (ProseMirror click handler), readonly-content
 * (react-markdown link component), and link-hover-card (Open button).
 */

import { isGlobalPath, isReservedSlug } from "../workspace-slug";
import { isTaskIdentifier } from "@uniwork/ui/markdown";
import {
  navigateInternal,
  type LinkClickIntent,
} from "@uniwork/views/navigation";

/**
 * Top-level workspace-scoped routes. Used to detect "/{route}/..." paths that
 * were authored without an org/workspace prefix — we prepend the current
 * `orgSlug/workspaceSlug` so they resolve under /{org}/{ws}/{route}/... .
 *
 * Why a hardcoded allowlist: the heuristic must be conservative. A path like
 * "/acme/eng/tasks/abc" already has org+ws (first segment "acme" isn't a known
 * route), so leaving it alone is correct. A path like "/foo/bar" where "foo"
 * isn't a known route is ambiguous — we don't rewrite it. Only "/tasks/..."
 * style paths get auto-prefixed.
 */
const WORKSPACE_ROUTE_SEGMENTS = new Set([
  "tasks",
  "projects",
  "meetings",
  "chat",
  "inbox",
  "my-tasks",
  "members",
  "people",
  "settings",
  "agents",
]);

/**
 * Report whether a path is a workspace-scoped app page — `/{org}/{ws}/...`
 * (or a legacy slug-less workspace route) where the first segment is a slug a
 * workspace could actually own.
 *
 * The app origin also serves things the app router does not own: `/api/*`,
 * `/uploads/*` (local-storage attachments, proxied by web), `/_next/*`,
 * `/favicon.ico`, and the pre-workspace routes. Every one of those first
 * segments is already a reserved slug, so the reserved list — the same one the
 * backend enforces at workspace creation — answers this question without a
 * parallel deny-list that has to be kept in sync with the backend's routes.
 */
function isWorkspaceScopedPath(pathname: string): boolean {
  const first = pathname.split("/")[1] ?? "";
  if (!first) return false;
  let segment: string;
  try {
    segment = decodeURIComponent(first);
  } catch {
    return false;
  }
  return !isReservedSlug(segment.toLowerCase());
}

/**
 * Convert an absolute URL that points at a workspace page on this deployment's
 * own app into the in-app path it addresses; `null` for anything else.
 *
 * An agent or a user pasting `https://<app-host>/acme/eng/tasks/123` means the
 * same destination as `/acme/eng/tasks/123`. Without this, the URL reads as
 * external and opens in the system browser instead of routing in-app.
 *
 * `appOrigin` is the deployment's public app URL, which only the platform layer
 * knows (web: the current origin; desktop: the connected environment's app URL).
 * See `useAppOrigin()`.
 */
export function toInternalAppPath(
  href: string,
  appOrigin?: string | null,
): string | null {
  if (!appOrigin) return null;
  let target: URL;
  let app: URL;
  try {
    target = new URL(href);
    app = new URL(appOrigin);
  } catch {
    return null;
  }
  if (target.origin !== app.origin) return null;
  // Opaque origins (file:, data:) compare equal to each other; only real web
  // origins identify the app.
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (!isWorkspaceScopedPath(target.pathname)) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}

/** An in-app entity page addressed by a link — the two kinds that have a chip. */
export interface WorkspaceEntityRef {
  kind: "task" | "project";
  /**
   * Entity id, decoded from the path. A UUID for either kind, or — for a
   * task only — a bare identifier (`UNI-0`). Callers dispatch on the shape
   * with `isTaskIdentifier`: an identifier still has to be resolved to a real
   * task before it can be rendered as a chip.
   */
  id: string;
  /**
   * Org/workspace prefix the link names (`"acme/eng"`), or `null` for the
   * slug-less legacy form (`/projects/<uuid>`), which `openLink` resolves
   * against the current workspace. A caller that renders workspace-scoped data
   * MUST compare a non-null slug against the current one — the entity itself
   * is only resolvable inside the workspace that owns it.
   */
  slug: string | null;
}

const ENTITY_ROUTE_SEGMENTS: Record<string, WorkspaceEntityRef["kind"]> = {
  tasks: "task",
  projects: "project",
};

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Does this path segment address one entity of `kind`?
 *
 * A project is only ever addressed by UUID — it has no shorthand. A task has
 * both, and the identifier form is the one that matters most: copy-link builds
 * `paths.workspace(org, ws).task(identifier || id)`, so `UNI-0` is what a user
 * actually copies. Accepting only the UUID here would leave the shape people
 * really paste as a raw URL.
 *
 * Identifier-shaped ids are candidates, not hits: the caller resolves one
 * against the current workspace and keeps the plain link when it misses.
 */
function isEntityId(kind: WorkspaceEntityRef["kind"], id: string): boolean {
  return UUID_RE.test(id) || (kind === "task" && isTaskIdentifier(id));
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Stand-in origin for resolving a href that carries no origin of its own. The
 * `.invalid` TLD is reserved as permanently unresolvable (RFC 2606), so no
 * deployment can ever be served from it and no href can use it to pass as one.
 */
const RELATIVE_BASE = "https://link.invalid";

/**
 * Resolve a link to the path it addresses on THIS deployment; `null` when it
 * addresses anywhere else.
 *
 * Resolving through `URL` rather than testing the string is what makes the
 * answer trustworthy. A leading slash does not mean "this site":
 * `//other.example/x` and `/\other.example/x` both start with one and both name
 * another host, which is where a browser goes. A parser sees the host; a prefix
 * test cannot, and no amount of extra prefixes closes the gap — that is why the
 * shape of this check matters more than the cases it currently rejects.
 *
 * With no `appOrigin` (a platform that cannot report one), only a genuinely
 * relative href resolves: anything carrying a host of its own fails the
 * comparison, which is the safe direction.
 */
function toSameOriginPath(
  href: string,
  appOrigin?: string | null,
): string | null {
  const base = appOrigin || RELATIVE_BASE;
  let target: URL;
  let expected: URL;
  try {
    target = new URL(href, base);
    expected = new URL(base);
  } catch {
    return null;
  }
  // Opaque origins (`javascript:`, `data:`) stringify to "null" and can never
  // equal a real one, so they fall out here too.
  if (target.origin !== expected.origin) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}

/**
 * Parse a link that addresses exactly one task or project page on this
 * deployment; `null` for everything else — external URLs, list pages, deeper
 * routes, and links carrying a query string or fragment.
 *
 * Accepts a site-relative path and an absolute URL pointing back at this
 * deployment's app origin. Both go through the same origin comparison, so the
 * two forms cannot disagree about what counts as in-app.
 *
 * UniWork shapes:
 * - `/{orgSlug}/{workspaceSlug}/{tasks|projects}/{id}` (copy-link)
 * - `/{tasks|projects}/{id}` (slug-less legacy; openLink prefixes current org/ws)
 */
export function parseWorkspaceEntityLink(
  href: string,
  appOrigin?: string | null,
): WorkspaceEntityRef | null {
  const path = toSameOriginPath(href, appOrigin);
  if (!path) return null;
  // A query string or fragment addresses something more specific than the
  // entity page (a saved filter, an anchored comment). Collapsing that to a
  // plain entity reference would silently drop it.
  if (path.includes("?") || path.includes("#")) return null;

  const segments: string[] = [];
  for (const raw of path.split("/").filter(Boolean)) {
    const decoded = decodeSegment(raw);
    if (decoded === null) return null;
    segments.push(decoded);
  }

  let slug: string | null;
  let route: string | undefined;
  let id: string | undefined;
  if (segments.length === 4) {
    const [org, ws, third, fourth] = segments;
    if (
      !org ||
      !ws ||
      isReservedSlug(org.toLowerCase()) ||
      isReservedSlug(ws.toLowerCase())
    ) {
      return null;
    }
    slug = `${org}/${ws}`;
    route = third;
    id = fourth;
  } else if (segments.length === 2) {
    slug = null;
    [route, id] = segments;
  } else {
    return null;
  }

  const kind = route ? ENTITY_ROUTE_SEGMENTS[route] : undefined;
  if (!kind || !id || !isEntityId(kind, id)) return null;
  return { kind, id, slug };
}

/**
 * Host-supplied navigation for in-app paths. Prefer injecting
 * `useOptionalNavigation()` so clicks go through NavigationAdapter instead of
 * a CustomEvent nobody listens for.
 *
 * Disposition: `"push"` → in-place; tab intents should open a shareable URL
 * (adapters have no background-tab API today).
 */
export type OpenLinkNavigate = (
  path: string,
  disposition?: LinkClickIntent,
) => void;

/**
 * Open a link — internal paths call `navigate` when provided; external open a
 * new tab.
 *
 * If `currentSlug` is provided (`org/ws` from `useEditorWorkspaceSlug`) and
 * `href` is a workspace-scoped path lacking that prefix (e.g. "/tasks/abc"
 * instead of "/{org}/{ws}/tasks/abc"), the slug is prepended. This is for
 * legacy markdown content or future content where users forget the prefix.
 *
 * `appOrigin` lets absolute URLs pointing back at this deployment take the same
 * internal route as a relative path.
 *
 * `intent` is how the user clicked (see `resolveClickIntent`). External links
 * ignore it: they always hand off to the browser / system browser.
 *
 * Without `navigate`, internal push is a no-op (isolated mounts); tab intents
 * still `window.open` so middle-click / modifier clicks are not silent.
 */
export function openLink(
  href: string,
  currentSlug?: string | null,
  appOrigin?: string | null,
  intent: LinkClickIntent = "push",
  navigate?: OpenLinkNavigate,
): void {
  const internalPath = href.startsWith("/")
    ? href
    : toInternalAppPath(href, appOrigin);
  if (internalPath) {
    let path = internalPath;
    if (currentSlug && !isGlobalPath(path)) {
      const firstSegment = path.split("/")[1];
      if (firstSegment && WORKSPACE_ROUTE_SEGMENTS.has(firstSegment)) {
        // Path looks like /tasks/abc (no org/ws) — prepend current slug.
        path = `/${currentSlug}${path}`;
      }
      // Otherwise the first segment is either already an org slug (e.g. "acme"
      // in "/acme/eng/tasks") or something unknown (e.g. "/foo"). Leave it —
      // the user wrote what they meant.
    }
    if (navigate) {
      navigate(path, intent);
      return;
    }
    navigateInternal(undefined, path, intent);
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

/** Check if a href is a mention protocol link (should not be opened as a regular link). */
export function isMentionHref(href: string | null | undefined): href is string {
  return !!href && href.startsWith("mention://");
}
