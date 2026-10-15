import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  openLink,
  parseWorkspaceEntityLink,
  toInternalAppPath,
  isMentionHref,
  type OpenLinkNavigate,
} from "./link-handler";
import type { EditorLinkContext } from "../editor-link-context";

const APP_ORIGIN = "https://app.uniwork.ai";
const CURRENT_SLUG = "acme/eng";

let navigated: Array<{ path: string; disposition?: string }> = [];
let navigate: OpenLinkNavigate;
let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  navigated = [];
  navigate = (path, disposition) => {
    navigated.push({ path, disposition });
  };
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toInternalAppPath", () => {
  it("returns the path (with search and hash) for a URL on the app origin", () => {
    expect(
      toInternalAppPath(`${APP_ORIGIN}/acme/eng/tasks/UNI-0?tab=a#c`, APP_ORIGIN),
    ).toBe("/acme/eng/tasks/UNI-0?tab=a#c");
  });

  it("returns null for another origin", () => {
    expect(toInternalAppPath("https://github.com/a/b/pull/1", APP_ORIGIN)).toBeNull();
  });

  it("returns null when the platform exposes no app origin", () => {
    expect(toInternalAppPath(`${APP_ORIGIN}/acme/eng/tasks/1`, null)).toBeNull();
  });

  it("keeps backend-served paths external so downloads and assets still work", () => {
    // Every one of these first segments is a reserved slug, which is exactly
    // why the reserved list — not a hand-kept deny-list — decides this.
    expect(
      toInternalAppPath(`${APP_ORIGIN}/api/attachments/abc/download`, APP_ORIGIN),
    ).toBeNull();
    expect(
      toInternalAppPath(`${APP_ORIGIN}/uploads/2026/07/report.pdf`, APP_ORIGIN),
    ).toBeNull();
    expect(toInternalAppPath(`${APP_ORIGIN}/uploads`, APP_ORIGIN)).toBeNull();
    expect(toInternalAppPath(`${APP_ORIGIN}/_next/static/x.js`, APP_ORIGIN)).toBeNull();
    expect(toInternalAppPath(`${APP_ORIGIN}/favicon.ico`, APP_ORIGIN)).toBeNull();
  });

  it("keeps pre-workspace and root paths external — they are not workspace pages", () => {
    expect(toInternalAppPath(`${APP_ORIGIN}/login`, APP_ORIGIN)).toBeNull();
    expect(toInternalAppPath(`${APP_ORIGIN}/auth/callback`, APP_ORIGIN)).toBeNull();
    expect(toInternalAppPath(`${APP_ORIGIN}/`, APP_ORIGIN)).toBeNull();
  });

  it("ignores case and percent-encoding when matching a reserved first segment", () => {
    expect(toInternalAppPath(`${APP_ORIGIN}/UPLOADS/x.pdf`, APP_ORIGIN)).toBeNull();
    expect(toInternalAppPath(`${APP_ORIGIN}/%75ploads/x.pdf`, APP_ORIGIN)).toBeNull();
  });

  it("returns null for non-http schemes and unparseable hrefs", () => {
    expect(toInternalAppPath("mailto:a@b.com", APP_ORIGIN)).toBeNull();
    expect(toInternalAppPath("not a url", APP_ORIGIN)).toBeNull();
  });
});

describe("openLink", () => {
  it("navigates in-app for a URL pointing back at this deployment", () => {
    openLink(`${APP_ORIGIN}/acme/eng/tasks/UNI-0`, CURRENT_SLUG, APP_ORIGIN, "push", navigate);
    expect(navigated).toEqual([{ path: "/acme/eng/tasks/UNI-0", disposition: "push" }]);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("navigates in-app for a cross-workspace app URL without rewriting the slug", () => {
    openLink(`${APP_ORIGIN}/other/ws/tasks/UNI-0`, CURRENT_SLUG, APP_ORIGIN, "push", navigate);
    expect(navigated).toEqual([{ path: "/other/ws/tasks/UNI-0", disposition: "push" }]);
  });

  it("opens an external URL in a new window", () => {
    openLink("https://github.com/uniwork-ai/uniwork/pull/1", CURRENT_SLUG, APP_ORIGIN, "push", navigate);
    expect(navigated).toHaveLength(0);
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/uniwork-ai/uniwork/pull/1",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("still opens an app URL externally when no app origin is known", () => {
    openLink(`${APP_ORIGIN}/acme/eng/tasks/UNI-0`, CURRENT_SLUG, undefined, "push", navigate);
    expect(navigated).toHaveLength(0);
    expect(openSpy).toHaveBeenCalled();
  });

  it("prefixes the current org/ws slug on a slugless workspace path", () => {
    openLink("/tasks/UNI-0", CURRENT_SLUG, APP_ORIGIN, "push", navigate);
    expect(navigated).toEqual([{ path: "/acme/eng/tasks/UNI-0", disposition: "push" }]);
  });

  it("leaves a path that already carries org/ws alone", () => {
    openLink("/other/ws/tasks/UNI-0", CURRENT_SLUG, APP_ORIGIN, "push", navigate);
    expect(navigated).toEqual([{ path: "/other/ws/tasks/UNI-0", disposition: "push" }]);
  });

  it("defaults the disposition to push and carries an explicit click intent", () => {
    openLink("/acme/eng/tasks/UNI-0", CURRENT_SLUG, APP_ORIGIN, "push", navigate);
    openLink("/acme/eng/tasks/UNI-0", CURRENT_SLUG, APP_ORIGIN, "background-tab", navigate);
    expect(navigated).toEqual([
      { path: "/acme/eng/tasks/UNI-0", disposition: "push" },
      { path: "/acme/eng/tasks/UNI-0", disposition: "background-tab" },
    ]);
  });

  it("ignores the intent for an external URL — it always hands off to the browser", () => {
    openLink("https://github.com/a/b", CURRENT_SLUG, APP_ORIGIN, "foreground-tab", navigate);
    expect(navigated).toHaveLength(0);
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/a/b",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("falls back without navigate by opening a tab for non-push intents", () => {
    openLink("/acme/eng/tasks/UNI-0", CURRENT_SLUG, APP_ORIGIN, "background-tab");
    expect(openSpy).toHaveBeenCalledWith(
      "/acme/eng/tasks/UNI-0",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("no-ops push without navigate and recognizes mention hrefs", () => {
    openLink("/acme/eng/tasks/UNI-0", CURRENT_SLUG, APP_ORIGIN, "push");
    expect(openSpy).not.toHaveBeenCalled();
    expect(isMentionHref("mention://member/u1")).toBe(true);
    expect(isMentionHref("https://example.com")).toBe(false);
    expect(isMentionHref(null)).toBe(false);
  });
});

describe("parseWorkspaceEntityLink", () => {
  const PROJECT_ID = "8f14e45f-ceea-4d0e-a1a2-9b1c0d3e4f5a";
  const TASK_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

  it("parses an absolute project URL on the app origin", () => {
    expect(
      parseWorkspaceEntityLink(
        `${APP_ORIGIN}/acme/eng/projects/${PROJECT_ID}`,
        APP_ORIGIN,
      ),
    ).toEqual({ kind: "project", id: PROJECT_ID, slug: "acme/eng" });
  });

  it("parses an absolute task URL on the app origin", () => {
    expect(
      parseWorkspaceEntityLink(`${APP_ORIGIN}/acme/eng/tasks/${TASK_ID}`, APP_ORIGIN),
    ).toEqual({ kind: "task", id: TASK_ID, slug: "acme/eng" });
  });

  it("parses a site-relative path without needing an app origin", () => {
    expect(parseWorkspaceEntityLink(`/acme/eng/projects/${PROJECT_ID}`)).toEqual({
      kind: "project",
      id: PROJECT_ID,
      slug: "acme/eng",
    });
  });

  it("reports a null slug for the slugless legacy form", () => {
    expect(parseWorkspaceEntityLink(`/projects/${PROJECT_ID}`)).toEqual({
      kind: "project",
      id: PROJECT_ID,
      slug: null,
    });
  });

  it("returns null for another origin", () => {
    expect(
      parseWorkspaceEntityLink(
        `https://evil.example/acme/eng/projects/${PROJECT_ID}`,
        APP_ORIGIN,
      ),
    ).toBeNull();
  });

  // A leading slash does not mean "this site". Both of these name another host
  // and a browser follows them there, so the parser has to resolve the href
  // rather than test its prefix.
  it("returns null for a host-bearing href that still starts with a slash", () => {
    expect(
      parseWorkspaceEntityLink(`//evil.example/projects/${PROJECT_ID}`, APP_ORIGIN),
    ).toBeNull();
    // Backslashes are normalised to slashes, so this names evil.example too —
    // and it slips past a `//` prefix test.
    expect(
      parseWorkspaceEntityLink(`/\\evil.example/projects/${PROJECT_ID}`, APP_ORIGIN),
    ).toBeNull();
  });

  it("returns null for a non-http scheme", () => {
    expect(parseWorkspaceEntityLink("javascript:alert(1)", APP_ORIGIN)).toBeNull();
  });

  // The slugless form resolves against the current workspace either way; the
  // two spellings must not disagree about that.
  it("treats the slugless form the same whether or not it carries the origin", () => {
    expect(
      parseWorkspaceEntityLink(`${APP_ORIGIN}/projects/${PROJECT_ID}`, APP_ORIGIN),
    ).toEqual({ kind: "project", id: PROJECT_ID, slug: null });
  });

  it("returns null for a list page", () => {
    expect(parseWorkspaceEntityLink("/acme/eng/projects")).toBeNull();
  });

  it("returns null for a deeper route under the entity", () => {
    expect(
      parseWorkspaceEntityLink(`/acme/eng/projects/${PROJECT_ID}/settings`),
    ).toBeNull();
  });

  it("returns null for an entity route this parser has no chip for", () => {
    expect(parseWorkspaceEntityLink(`/acme/eng/agents/${PROJECT_ID}`)).toBeNull();
  });

  // A query string or fragment addresses something narrower than the entity
  // page, and a chip cannot carry it.
  it("returns null when the link carries a query string or fragment", () => {
    expect(
      parseWorkspaceEntityLink(`/acme/eng/projects/${PROJECT_ID}?tab=tasks`),
    ).toBeNull();
    expect(
      parseWorkspaceEntityLink(`/acme/eng/tasks/${TASK_ID}#comment-3`),
    ).toBeNull();
  });

  // Copy-link builds paths.workspace(org, ws).task(identifier || id).
  it("parses a task addressed by identifier", () => {
    expect(parseWorkspaceEntityLink("/acme/eng/tasks/UNI-0")).toEqual({
      kind: "task",
      id: "UNI-0",
      slug: "acme/eng",
    });
  });

  // A project has no shorthand, so an identifier-shaped id under /projects/
  // addresses nothing this parser could resolve.
  it("returns null for an identifier-shaped project id", () => {
    expect(parseWorkspaceEntityLink("/acme/eng/projects/UNI-0")).toBeNull();
  });

  it("returns null for an id that is neither a UUID nor an identifier", () => {
    expect(parseWorkspaceEntityLink("/acme/eng/tasks/roadmap")).toBeNull();
    // Lowercase is not the identifier form — matching it would turn ordinary
    // hyphenated path segments into entity references.
    expect(parseWorkspaceEntityLink("/acme/eng/tasks/mul-1")).toBeNull();
  });

  it("returns null when the org position holds a reserved slug", () => {
    expect(parseWorkspaceEntityLink(`/login/eng/projects/${PROJECT_ID}`)).toBeNull();
  });

  it("returns null for the single-segment workspace shape", () => {
    expect(parseWorkspaceEntityLink(`/acme/tasks/UNI-0`)).toBeNull();
  });

  it("returns null for a malformed percent-escape", () => {
    expect(parseWorkspaceEntityLink("/acme/eng/projects/%E0%A4%A")).toBeNull();
  });
});

describe("openLink with an EditorLinkContext (DOC7-W03)", () => {
  const taskCtx: EditorLinkContext = { kind: "task", id: "T1" };

  it("tags an internal document path with ?from=task:<id>", () => {
    openLink("/acme/eng/documents/D1", CURRENT_SLUG, APP_ORIGIN, "push", navigate, taskCtx);
    expect(navigated).toEqual([{ path: "/acme/eng/documents/D1?from=task:T1", disposition: "push" }]);
  });

  it("tags an absolute URL on the app origin and keeps the other query and the hash", () => {
    openLink(
      `${APP_ORIGIN}/acme/eng/documents/D1?tab=a#h`,
      CURRENT_SLUG,
      APP_ORIGIN,
      "push",
      navigate,
      taskCtx,
    );
    expect(navigated[0]?.path).toBe("/acme/eng/documents/D1?tab=a&from=task:T1#h");
  });

  it("tags the slug-less legacy form", () => {
    openLink("/documents/D1", CURRENT_SLUG, APP_ORIGIN, "push", navigate, taskCtx);
    expect(navigated[0]?.path).toBe("/documents/D1?from=task:T1");
  });

  it("tags a background-tab open too", () => {
    openLink("/acme/eng/documents/D1", CURRENT_SLUG, APP_ORIGIN, "background-tab", navigate, taskCtx);
    expect(navigated[0]).toEqual({ path: "/acme/eng/documents/D1?from=task:T1", disposition: "background-tab" });
  });

  it("never tags when no context is set", () => {
    openLink("/acme/eng/documents/D1", CURRENT_SLUG, APP_ORIGIN, "push", navigate);
    openLink("/acme/eng/documents/D1", CURRENT_SLUG, APP_ORIGIN, "push", navigate, null);
    expect(navigated.map((n) => n.path)).toEqual(["/acme/eng/documents/D1", "/acme/eng/documents/D1"]);
  });

  it("never tags an external link, even one shaped like a document path", () => {
    openLink("https://evil.example/acme/eng/documents/D1", CURRENT_SLUG, APP_ORIGIN, "push", navigate, taskCtx);
    expect(navigated).toEqual([]);
    expect(openSpy).toHaveBeenCalledWith(
      "https://evil.example/acme/eng/documents/D1",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("leaves non-document internal links untouched", () => {
    openLink("/acme/eng/tasks/UNI-0", CURRENT_SLUG, APP_ORIGIN, "push", navigate, taskCtx);
    openLink("/acme/eng/documents", CURRENT_SLUG, APP_ORIGIN, "push", navigate, taskCtx);
    openLink("/acme/eng/documents/D1/extra", CURRENT_SLUG, APP_ORIGIN, "push", navigate, taskCtx);
    expect(navigated.map((n) => n.path)).toEqual([
      "/acme/eng/tasks/UNI-0",
      "/acme/eng/documents",
      "/acme/eng/documents/D1/extra",
    ]);
  });

  it("keeps a from the link already carries", () => {
    openLink("/acme/eng/documents/D1?from=task:OLD", CURRENT_SLUG, APP_ORIGIN, "push", navigate, taskCtx);
    expect(navigated[0]?.path).toBe("/acme/eng/documents/D1?from=task:OLD");
  });

  it("encodes an id that is not URL-safe and tags a meeting context the same way", () => {
    openLink("/acme/eng/documents/D1", CURRENT_SLUG, APP_ORIGIN, "push", navigate, { kind: "meeting", id: "a b" });
    expect(navigated[0]?.path).toBe("/acme/eng/documents/D1?from=meeting:a%20b");
  });
});
