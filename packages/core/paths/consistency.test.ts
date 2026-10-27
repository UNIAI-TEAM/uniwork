import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { GLOBAL_PREFIXES, isGlobalPath, parseDriveLibrarySelection, parseDriveNameFolderRequest, paths } from "./paths";
import { RESERVED_SLUGS } from "./reserved-slugs";

/**
 * paths.ts is the only place shared code may build a URL, so it must know
 * every route the app actually has — and nothing else. This walks the real
 * App Router tree instead of a copy of it: add a page without a builder (or a
 * builder without a page) and CI fails, rather than a link 404ing in
 * production.
 */
const APP_DIR = resolve(process.cwd(), "../../apps/web/app");

/** `[orgSlug]/[workspaceSlug]/tasks/[taskId]/page.tsx` → `/:org/:ws/tasks/:id` */
function routeTemplates(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "page.tsx") {
        const rel = relative(APP_DIR, d).replace(/\\/g, "/");
        const segs = rel
          .split("/")
          .filter((s) => s && !s.startsWith("(")) // route groups are invisible
          .map((s) => (s.startsWith("[") ? ":parameter" : s));
        if (rel.includes("[[...")) out.push("/" + segs.slice(0, -1).join("/"));
        out.push("/" + segs.join("/"));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Every URL the builders can produce, with probe values in the params. */
function builderTemplates(): string[] {
  const ORG = "__org__";
  const WS = "__ws__";
  const ID = "__id__";
  const globals = [
    paths.root(),
    paths.login(),
    paths.register(),
    paths.verify(),
    paths.authCallback(),
    paths.desktopAuthorize(),
    paths.connectAuthorize(),
    paths.unichatStart(),
    paths.forgotPassword(),
    paths.resetPassword(),
    paths.onboarding(),
    paths.getStarted(),
    paths.noWorkspace(),
    paths.newWorkspace(),
    paths.invitations(),
    paths.workspaces(),
    paths.invite(ID),
    paths.meetingInvite(ID),
    paths.meetingInviteRoom(ID),
    paths.publicShare(ID),
    paths.solutions.product(),
    paths.solutions.root(),
    paths.features(),
    paths.feature(ID),
    paths.learn(),
    paths.changelog(),
    paths.pricing(),
    paths.enterprise(),
    paths.requestDemo(),
    paths.apps.root(),
    paths.apps.office(),
    paths.apps.unichat(),
    paths.about(),
    paths.security(),
    paths.privacy(),
    paths.terms(),
    paths.guide(ID),
    paths.vietnamese(),
    paths.vietnamese([ID]),
    paths.solutions.operations(),
    paths.whyUniwork(),
    paths.admin.root(),
    paths.admin.organizations(),
    paths.admin.demoRequests(),
    paths.admin.chatReports(),
    paths.admin.organization(ID),
    paths.admin.flags(),
    paths.admin.plans(),
    paths.admin.invoices(),
    paths.admin.trace(),
    paths.admin.quota(),
    paths.admin.system(),
  ];
  const ws = paths.workspace(ORG, WS);
  const scoped = [ws.root(), ws.tasks(), ws.task(ID), ws.myTasks(), ws.projects(), ws.project(ID), ws.calendar(), ws.meetings(), ws.meeting(ID), ws.room(ID), ws.chat(), ws.chatSettings(), ws.inbox(), ws.email(), ws.members(), ws.people(), ws.person(ID), ws.documents(), ws.documentsAccessReport(), ws.documentsDriveFile(ID), ws.document(ID), ws.settings()];
  return [...globals, ...scoped]
    .map((p) =>
      p
        .replace(`/${ORG}/${WS}`, "/:orgSlug/:workspaceSlug")
        .replace(/__id__/g, ":id"),
    )
    .map((p) => (p === "" ? "/" : p))
    .sort();
}

/** Route params carry their own names in the tree; the builders only care that a slot exists. */
function normalizeParams(t: string): string {
  return t.replace(/:[A-Za-z]+/g, ":p");
}

describe("paths stay in step with the app's routes", () => {
  it("every page has a builder and every builder has a page", () => {
    const routes = new Set(routeTemplates(APP_DIR).map(normalizeParams));
    const builders = new Set(builderTemplates().map(normalizeParams));
    const missingBuilder = [...routes].filter((r) => !builders.has(r));
    const missingRoute = [...builders].filter((b) => !routes.has(b));
    expect(missingBuilder, `pages without a paths builder: ${missingBuilder.join(", ")}`).toEqual([]);
    expect(missingRoute, `builders without a page: ${missingRoute.join(", ")}`).toEqual([]);
  });

  it("builds Google Drive library and file detail paths", () => {
    const ws = paths.workspace("acme", "team");
    expect(ws.documentsDrive()).toBe("/acme/team/documents?view=drive");
    expect(ws.documentsDrive("conn-1")).toBe("/acme/team/documents?view=drive&account=conn-1");
    expect(ws.documentsDriveFile("df-1")).toBe("/acme/team/documents/drive/df-1");
  });

  it("builds and parses the Drive library account + folder selection (round trip)", () => {
    const ws = paths.workspace("acme", "team");
    expect(ws.documentsDrive("conn-1", "fld/1 é")).toBe(
      "/acme/team/documents?view=drive&account=conn-1&driveFolder=fld%2F1%20%C3%A9",
    );
    // A folder without an account is dropped: the folder only exists under an account.
    expect(ws.documentsDrive(null, "fld-1")).toBe("/acme/team/documents?view=drive");
    for (const [account, folder] of [["conn-1", "fld/1 é"], ["conn-1", null], [null, null]] as const) {
      const url = new URL(ws.documentsDrive(account, folder), "http://x");
      expect(parseDriveLibrarySelection(url.searchParams)).toEqual({ account, folder });
    }
    expect(parseDriveLibrarySelection(new URLSearchParams("view=drive&driveFolder=f"))).toEqual({
      account: null,
      folder: null,
    });
    expect(parseDriveLibrarySelection(new URLSearchParams("view=drive&account=&driveFolder="))).toEqual({
      account: null,
      folder: null,
    });
  });

  it("builds and parses the nameFolder request, which needs an account and a folder", () => {
    const ws = paths.workspace("acme", "team");
    expect(ws.documentsDrive("conn-1", "fld/1", { nameFolder: true })).toBe(
      "/acme/team/documents?view=drive&account=conn-1&driveFolder=fld%2F1&nameFolder=1",
    );
    expect(ws.documentsDrive("conn-1", "fld-1", { nameFolder: false })).toBe(ws.documentsDrive("conn-1", "fld-1"));
    expect(ws.documentsDrive("conn-1", null, { nameFolder: true })).toBe(ws.documentsDrive("conn-1"));
    const url = new URL(ws.documentsDrive("conn-1", "fld/1", { nameFolder: true }), "http://x");
    expect(parseDriveNameFolderRequest(url.searchParams)).toBe(true);
    expect(parseDriveLibrarySelection(url.searchParams)).toEqual({ account: "conn-1", folder: "fld/1" });
    expect(parseDriveNameFolderRequest(new URLSearchParams("view=drive&account=c&driveFolder=f"))).toBe(false);
    expect(parseDriveNameFolderRequest(new URLSearchParams("view=drive&account=c&driveFolder=f&nameFolder=0"))).toBe(false);
    expect(parseDriveNameFolderRequest(new URLSearchParams("view=drive&account=c&nameFolder=1"))).toBe(false);
    expect(parseDriveNameFolderRequest(new URLSearchParams("view=drive&driveFolder=f&nameFolder=1"))).toBe(false);
  });
});

describe("global path / reserved slug consistency", () => {
  it("isGlobalPath agrees with the prefix list", () => {
    for (const prefix of GLOBAL_PREFIXES) expect(isGlobalPath(prefix)).toBe(true);
    expect(isGlobalPath("/acme/team/tasks")).toBe(false);
    expect(isGlobalPath("/")).toBe(false);
  });

  it("every global prefix's first segment is a reserved slug", () => {
    // Otherwise an organization could be created with that slug and shadow
    // the global route's URL space.
    const reserved = new Set<string>(RESERVED_SLUGS);
    for (const prefix of GLOBAL_PREFIXES) {
      const first = prefix.split("/").filter(Boolean)[0];
      if (!first) continue;
      expect(reserved.has(first), `'${first}' is a global prefix but not a reserved slug`).toBe(true);
    }
  });
});
