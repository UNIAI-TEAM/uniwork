import { afterEach, describe, expect, it } from "vitest";

import {
  bucketDiagnosticPath,
  getDiagnosticRoute,
  resetDiagnosticContext,
  setDiagnosticRoute,
} from "./diagnostic-context";
import { paths } from "../paths";

afterEach(() => {
  resetDiagnosticContext();
});

describe("diagnostic route", () => {
  it("holds the published route", () => {
    setDiagnosticRoute("/:slug/issues");
    expect(getDiagnosticRoute()).toBe("/:slug/issues");
  });

  it("treats empty and whitespace values as absent", () => {
    setDiagnosticRoute("   ");
    expect(getDiagnosticRoute()).toBeNull();
  });

  it("clears on null, so a window that leaves a route stops claiming it", () => {
    setDiagnosticRoute("/:slug/issues");
    setDiagnosticRoute(null);
    expect(getDiagnosticRoute()).toBeNull();
  });
});

describe("bucketDiagnosticPath", () => {
  it("replaces the organization and workspace slugs", () => {
    expect(bucketDiagnosticPath("/acme/team/tasks")).toBe("/:org/:slug/tasks");
    expect(bucketDiagnosticPath("/acme/team/my-tasks")).toBe(
      "/:org/:slug/my-tasks",
    );
    expect(bucketDiagnosticPath("/acme/team/projects")).toBe(
      "/:org/:slug/projects",
    );
    expect(bucketDiagnosticPath("/acme/team/squads")).toBe("/:org/:slug/squads");
    expect(bucketDiagnosticPath("/acme/team/runtimes")).toBe(
      "/:org/:slug/runtimes",
    );
  });

  it("templates every workspace detail route", () => {
    expect(bucketDiagnosticPath("/acme/team/tasks/t-5345")).toBe(
      "/:org/:slug/tasks/:id",
    );
    expect(bucketDiagnosticPath("/acme/team/projects/p1")).toBe(
      "/:org/:slug/projects/:id",
    );
    expect(bucketDiagnosticPath("/acme/team/meetings/m1")).toBe(
      "/:org/:slug/meetings/:id",
    );
    expect(bucketDiagnosticPath("/acme/team/meetings/m1/room")).toBe(
      "/:org/:slug/meetings/:id/room",
    );
    expect(bucketDiagnosticPath("/acme/team/members")).toBe(
      "/:org/:slug/members",
    );
  });

  // The previous implementation guessed from the shape of a segment, so any id
  // that was not a UUID or digits travelled to telemetry intact.
  it("templates ids that look nothing like ids", () => {
    for (const [path, expected] of [
      ["/acme/team/tasks/p1", "/:org/:slug/tasks/:id"],
      ["/acme/team/tasks/my-favourite-task", "/:org/:slug/tasks/:id"],
      ["/acme/team/meetings/Planning Call", "/:org/:slug/meetings/:id"],
      ["/acme/team/tasks/new", "/:org/:slug/tasks/:id"],
    ] as const) {
      expect(bucketDiagnosticPath(path)).toBe(expected);
    }
  });

  // paths.ts URL-encodes every id, so an id containing a slash or a space
  // arrives as one already-escaped segment.
  it("templates percent-encoded ids without splitting them", () => {
    expect(bucketDiagnosticPath("/acme/team/tasks/a%2Fb")).toBe(
      "/:org/:slug/tasks/:id",
    );
    expect(bucketDiagnosticPath("/my%20org/my%20team/tasks/a%20b")).toBe(
      "/:org/:slug/tasks/:id",
    );
  });

  it("keeps pre-workspace routes intact", () => {
    expect(bucketDiagnosticPath("/login")).toBe("/login");
    expect(bucketDiagnosticPath("/register")).toBe("/register");
    expect(bucketDiagnosticPath("/workspaces/new")).toBe("/workspaces/new");
    expect(bucketDiagnosticPath("/invitations")).toBe("/invitations");
    expect(bucketDiagnosticPath("/onboarding")).toBe("/onboarding");
  });

  it("templates the invitation token", () => {
    expect(
      bucketDiagnosticPath("/invite/8db920bc-f982-4d38-95f3-56ec43cbefa8"),
    ).toBe("/invite/:token");
    expect(bucketDiagnosticPath("/invite/plain-token")).toBe("/invite/:token");
  });

  it("drops query string and hash — they can carry resource ids", () => {
    expect(bucketDiagnosticPath("/acme/team/tasks?task=t-1#comment-3")).toBe(
      "/:org/:slug/tasks",
    );
  });

  it("normalizes the root, a bare org and a bare workspace path", () => {
    expect(bucketDiagnosticPath("/")).toBe("/");
    expect(bucketDiagnosticPath("/acme")).toBe("/:org");
    expect(bucketDiagnosticPath("/acme/team")).toBe("/:org/:slug");
  });

  // A route we do not know is exactly the case where an id cannot be told from
  // a page name, so nothing from it travels.
  it("masks an unknown route instead of passing segments through", () => {
    expect(bucketDiagnosticPath("/acme/team/tasks/t-1/secret-tab")).toBe(
      "/:org/:slug/tasks/*",
    );
    expect(bucketDiagnosticPath("/acme/team/not-a-section/raw-value")).toBe(
      "/:org/:slug/*",
    );
    expect(bucketDiagnosticPath("/login/raw-value")).toBe("/login/*");
  });
});

// Bucketing is only safe while it knows every route. This walks the real path
// builders rather than a copy of them, so adding a route to paths.ts without
// adding it here fails CI instead of shipping a raw id.
describe("route coverage stays in step with paths.ts", () => {
  const ORG = "org-slug-value";
  const SLUG = "workspace-slug-value";
  const RAW_ID = "raw-identifier-value";
  const RAW_SECOND_ID = "second-raw-identifier-value";

  function buildAll(): string[] {
    const scoped = paths.workspace(ORG, SLUG) as Record<string, (...args: string[]) => string>;
    const global = {
      login: paths.login,
      newWorkspace: paths.newWorkspace,
      invite: paths.invite,
      invitations: paths.invitations,
      onboarding: paths.onboarding,
      root: paths.root,
    } as Record<string, (...args: string[]) => string>;

    return [...Object.values(scoped), ...Object.values(global)].map((build) =>
      build(RAW_ID, RAW_SECOND_ID),
    );
  }

  it("never lets a slug or an id through, for any builder", () => {
    for (const built of buildAll()) {
      const bucketed = bucketDiagnosticPath(built);
      expect(bucketed, `leaked from ${built}`).not.toContain(SLUG);
      expect(bucketed, `leaked from ${built}`).not.toContain(RAW_ID);
      expect(bucketed, `leaked from ${built}`).not.toContain(RAW_SECOND_ID);
    }
  });

  it("recognizes every builder — no builder falls back to the mask", () => {
    for (const built of buildAll()) {
      expect(bucketDiagnosticPath(built), `unrecognized: ${built}`).not.toContain("*");
    }
  });
});
