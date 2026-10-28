import { describe, expect, it } from "vitest";
import {
  GLOBAL_PREFIXES,
  isGlobalPath,
  isReservedSlug,
  paths,
  pendingAuthStep,
  resolveHomeDestination,
  resolvePostAuthDestination,
  sanitizeNextUrl,
  workspacelessDestination,
} from "./index";
import type { Workspace } from "../types";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";

const ws = (org: string, slug: string): Workspace => ({
  id: slug, slug, name: slug, organization_id: org, organization_slug: org, organization_name: org,
});

const org = (id: string, status = "active", role = "owner") => ({ id, status, role });
const member = (id: string) => org(id, "active", "member");

const verified = { email_verified_at: "2026-08-27T00:00:00Z", onboarded_at: null };
const onboarded = { email_verified_at: "2026-08-27T00:00:00Z", onboarded_at: "2026-08-27T00:00:00Z" };
const unverified = { email_verified_at: null, onboarded_at: null };

describe("pendingAuthStep", () => {
  it("verify comes before onboarding", () => {
    expect(pendingAuthStep(unverified)).toBe("verify");
    expect(pendingAuthStep({ email_verified_at: null, onboarded_at: "2026-08-27T00:00:00Z" })).toBe("verify");
    expect(pendingAuthStep(verified)).toBe("onboarding");
    expect(pendingAuthStep(onboarded)).toBeNull();
    expect(pendingAuthStep(null)).toBeNull();
  });
});

describe("resolvePostAuthDestination", () => {
  it("sends unverified users to verify regardless of workspaces", () => {
    expect(resolvePostAuthDestination([ws("unicom", "alpha")], unverified)).toBe("/verify");
  });
  it("sends un-onboarded users to onboarding regardless of workspaces", () => {
    expect(resolvePostAuthDestination([ws("unicom", "alpha")], verified)).toBe("/onboarding");
  });
  it("lands on the first workspace tasks", () => {
    expect(resolvePostAuthDestination([ws("unicom", "alpha"), ws("x", "y")], onboarded)).toBe("/unicom/alpha/tasks");
  });
  it("onboarded with no workspace → new workspace", () => {
    expect(resolvePostAuthDestination([], onboarded)).toBe("/workspaces/new");
  });
  it("an owner or admin of an organization without a workspace yet is led to create one", () => {
    expect(resolvePostAuthDestination([], onboarded, [org("o1")])).toBe("/workspaces/new");
    expect(resolvePostAuthDestination([], onboarded, [org("o1", "active", "admin")])).toBe("/workspaces/new");
  });
  /**
   * UNI-1472: somebody who joined through an invitation that opened no
   * workspace is a member of the organization with nowhere to go. They are
   * told so and to ask an admin, never put through creating an organization
   * or a workspace.
   */
  it("a plain member with no workspace lands on /no-workspace, never on the create flow", () => {
    expect(resolvePostAuthDestination([], onboarded, [member("o1")])).toBe("/no-workspace");
    expect(resolveHomeDestination([], onboarded, null, [member("o1")])).toBe("/no-workspace");
    // An unknown role is read as the least privileged.
    expect(resolvePostAuthDestination([], onboarded, [org("o1", "active", "guest")])).toBe("/no-workspace");
    expect(resolvePostAuthDestination([], onboarded, [{ id: "o1", status: "active" }])).toBe("/no-workspace");
  });
  it("a member who has a workspace still lands in it", () => {
    expect(resolvePostAuthDestination([ws("o1", "sales")], onboarded, [member("o1")])).toBe("/o1/sales/tasks");
  });
  it("workspacelessDestination is the same answer for the screens that have no workspace to offer", () => {
    expect(workspacelessDestination([member("o1")])).toBe("/no-workspace");
    expect(workspacelessDestination([org("o1")])).toBe("/workspaces/new");
    expect(workspacelessDestination([])).toBe("/get-started");
    expect(workspacelessDestination([{ ...member("o1"), deactivated: true }])).toBe("/get-started");
    // Without the organization list the gates cannot tell; creating stays the way on.
    expect(workspacelessDestination(undefined)).toBe("/workspaces/new");
  });
  it("no organization at all → /get-started (ADR 0032 D12)", () => {
    expect(resolvePostAuthDestination([], onboarded, [])).toBe("/get-started");
  });
  it("skips workspaces of an organization the list says the user no longer holds", () => {
    const list = [ws("closed", "alpha"), ws("acme", "team")];
    expect(resolvePostAuthDestination(list, onboarded, [org("closed", "archived"), org("acme")])).toBe(
      "/acme/team/tasks",
    );
    expect(resolvePostAuthDestination([ws("closed", "alpha")], onboarded, [org("closed", "archived")])).toBe(
      "/get-started",
    );
  });
  /**
   * GET /orgs degrades to [] when its answer drifts, and GET /workspaces
   * already leaves closed organizations out: an empty list must not send a
   * person who still has workspaces to /get-started.
   */
  it("an empty or drifted organization list does not hide the workspaces the server lists", () => {
    expect(resolvePostAuthDestination([ws("acme", "team")], onboarded, [])).toBe("/acme/team/tasks");
    expect(resolveHomeDestination([ws("acme", "team")], onboarded, null, [])).toBe("/acme/team");
  });
  it("a suspended organization still counts as belonging (ADR 0032 D1)", () => {
    expect(resolvePostAuthDestination([], onboarded, [org("o1", "suspended")])).toBe("/workspaces/new");
  });
  it("a deactivated membership does not count as belonging (ADR 0032 D1)", () => {
    const off = { ...org("closed"), deactivated: true };
    expect(resolvePostAuthDestination([], onboarded, [off])).toBe("/get-started");
    expect(resolvePostAuthDestination([ws("closed", "alpha")], onboarded, [off])).toBe("/get-started");
    expect(resolvePostAuthDestination([ws("closed", "alpha"), ws("acme", "team")], onboarded, [off, org("acme")])).toBe(
      "/acme/team/tasks",
    );
    expect(resolveHomeDestination([ws("closed", "alpha")], onboarded, null, [off])).toBe("/get-started");
  });
  it("the gates still come first", () => {
    expect(resolvePostAuthDestination([], verified, [])).toBe("/onboarding");
  });
});

describe("resolveHomeDestination", () => {
  const list = [ws("unicom", "alpha"), ws("acme", "team")];
  it("returns to the workspace the user was last in", () => {
    expect(resolveHomeDestination(list, onboarded, { orgSlug: "acme", wsSlug: "team" })).toBe("/acme/team");
  });
  it("falls back to the first workspace on a first visit", () => {
    expect(resolveHomeDestination(list, onboarded, null)).toBe("/unicom/alpha");
  });
  it("falls back to the first workspace when the last one is no longer theirs", () => {
    expect(resolveHomeDestination(list, onboarded, { orgSlug: "gone", wsSlug: "team" })).toBe("/unicom/alpha");
  });
  it("matches the organization too, since workspace slugs repeat across organizations", () => {
    expect(resolveHomeDestination(list, onboarded, { orgSlug: "unicom", wsSlug: "team" })).toBe("/unicom/alpha");
  });
  it("sends a user with a pending gate to that gate", () => {
    expect(resolveHomeDestination(list, unverified, { orgSlug: "acme", wsSlug: "team" })).toBe("/verify");
    expect(resolveHomeDestination(list, verified, null)).toBe("/onboarding");
  });
  it("onboarded with no workspace → new workspace", () => {
    expect(resolveHomeDestination([], onboarded, { orgSlug: "acme", wsSlug: "team" })).toBe("/workspaces/new");
  });
  it("no organization at all → /get-started, even with a remembered workspace", () => {
    expect(resolveHomeDestination([], onboarded, { orgSlug: "acme", wsSlug: "team" }, [])).toBe("/get-started");
  });
  it("never returns to a workspace of a membership that was switched off", () => {
    const off = { ...org("acme"), deactivated: true };
    expect(resolveHomeDestination(list, onboarded, { orgSlug: "acme", wsSlug: "team" }, [org("unicom"), off])).toBe(
      "/unicom/alpha",
    );
    expect(resolveHomeDestination([], onboarded, null, [org("unicom")])).toBe("/workspaces/new");
  });
});

describe("paths", () => {
  it("builds workspace urls", () => {
    expect(paths.workspace("unicom", "alpha").task("T1")).toBe("/unicom/alpha/tasks/T1");
    expect(paths.workspace("unicom", "alpha").room("M1")).toBe("/unicom/alpha/meetings/M1/room");
  });
  it("builds my-tasks under the workspace", () => {
    expect(paths.workspace("acme", "team").myTasks()).toBe("/acme/team/my-tasks");
  });
  it("builds calendar under the workspace", () => {
    expect(paths.workspace("acme", "team").calendar()).toBe("/acme/team/calendar");
  });
  it("builds projects under the workspace", () => {
    expect(paths.workspace("acme", "team").projects()).toBe("/acme/team/projects");
    expect(paths.workspace("acme", "team").project("P1")).toBe("/acme/team/projects/P1");
  });
  it("builds the auth pages and the absolute Google start url", () => {
    configureRuntime({ apiUrl: "http://api.test" });
    try {
      expect(paths.verify()).toBe("/verify");
      expect(paths.authCallback()).toBe("/auth/callback");
      expect(paths.googleStart()).toBe("http://api.test/api/v1/auth/google/start");
      expect(paths.googleStart({ next: "/acme/team" })).toBe("http://api.test/api/v1/auth/google/start?next=%2Facme%2Fteam");
      expect(paths.googleStart({ next: null })).toBe("http://api.test/api/v1/auth/google/start");
      // sign_up (the register page) creates the account at once; sign_in is the default and stays out of the URL.
      expect(paths.googleStart({ next: "/x", intent: "sign_up" })).toBe(
        "http://api.test/api/v1/auth/google/start?next=%2Fx&intent=sign_up",
      );
      expect(paths.googleStart({ intent: "sign_in" })).toBe("http://api.test/api/v1/auth/google/start");
      expect(paths.appleStart()).toBe("http://api.test/api/v1/auth/apple/start");
      expect(paths.appleStart({ next: "/invite/t1", intent: "sign_up" })).toBe(
        "http://api.test/api/v1/auth/apple/start?next=%2Finvite%2Ft1&intent=sign_up",
      );
    } finally {
      resetRuntimeConfig();
    }
  });

  it("carries next (and the link mode) through every sign-in page (ADR 0047, spec §4.2–4.4)", () => {
    expect(paths.login()).toBe("/login");
    expect(paths.login({ next: "/acme/team" })).toBe("/login?next=%2Facme%2Fteam");
    const linkStep = paths.authContinue({ step: "link", next: "/invite/t1" });
    expect(linkStep).toBe("/auth/continue?step=link&next=%2Finvite%2Ft1");
    expect(paths.login({ next: linkStep, link: true })).toBe(
      `/login?next=${encodeURIComponent(linkStep)}&link=1`,
    );
    expect(paths.authContinue()).toBe("/auth/continue");
    // The app's provider button rides the desktop consent page's sign-in (spec §3.5).
    const consent = "/auth/desktop/authorize?attempt_id=01J";
    expect(paths.login({ next: consent, provider: "apple" })).toBe(`/login?next=${encodeURIComponent(consent)}&provider=apple`);
    expect(paths.login({ provider: null })).toBe("/login");
    expect(paths.login({ next: "/acme/team", error: "sign_in_failed" })).toBe("/login?next=%2Facme%2Fteam&error=sign_in_failed");
    // A reset whose account has a second factor opens /login on the code step, still linking.
    expect(paths.login({ mfa: true, link: true, next: linkStep })).toBe(
      `/login?mfa=1&next=${encodeURIComponent(linkStep)}&link=1`,
    );
    expect(paths.register({ next: "/invite/t1" })).toBe("/register?next=%2Finvite%2Ft1");
    expect(paths.verify({ next: "/x" })).toBe("/verify?next=%2Fx");
    expect(paths.onboarding({ next: "/x" })).toBe("/onboarding?next=%2Fx");
    expect(paths.forgotPassword({ next: "/x" })).toBe("/forgot-password?next=%2Fx");
    expect(paths.register({ next: null })).toBe("/register");
  });

  it("builds the account-level settings the server sends a link back to", () => {
    expect(paths.accountSettings()).toBe("/settings");
    expect(paths.securitySettings()).toBe("/settings?tab=security");
    expect(paths.securitySettings({ expectUser: "01J8X4" })).toBe("/settings?tab=security&expect_user=01J8X4");
    expect(isReservedSlug("settings")).toBe(true);
    expect(isReservedSlug("auth")).toBe(true);
  });
});

describe("getStarted", () => {
  it("is a global route whose first segment is reserved", () => {
    expect(paths.getStarted()).toBe("/get-started");
    expect(GLOBAL_PREFIXES).toContain("/get-started");
    expect(isGlobalPath("/get-started")).toBe(true);
    expect(isReservedSlug("get-started")).toBe(true);
  });
});

describe("noWorkspace", () => {
  it("is a global route whose first segment is reserved", () => {
    expect(paths.noWorkspace()).toBe("/no-workspace");
    expect(GLOBAL_PREFIXES).toContain("/no-workspace");
    expect(isGlobalPath("/no-workspace")).toBe(true);
    expect(isReservedSlug("no-workspace")).toBe(true);
  });
});

describe("sanitizeNextUrl", () => {
  it("accepts same-origin paths only", () => {
    expect(sanitizeNextUrl("/invite/abc")).toBe("/invite/abc");
    expect(sanitizeNextUrl("//evil.com")).toBeNull();
    expect(sanitizeNextUrl("https://evil.com")).toBeNull();
    expect(sanitizeNextUrl(null)).toBeNull();
  });

  it("keeps in-app paths unchanged", () => {
    expect(sanitizeNextUrl("/acme/main/tasks?x=1#y")).toBe("/acme/main/tasks?x=1#y");
    expect(sanitizeNextUrl("/")).toBe("/");
  });

  // Browsers drop tab/CR/LF anywhere and trim C0 controls and spaces before
  // parsing, so "/\t/evil.com" navigates to "//evil.com", another host.
  it.each([
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\r\n/evil.com",
    "/ /evil.com",
    " //evil.com",
    "\t//evil.com",
    "/\\evil.com",
    "/a\\b",
    "/\u0000/evil.com",
    "/\u001f/evil.com",
    "/\u007f/evil.com",
    "/acme/main/tasks?q=a b",
  ])("rejects whitespace, control characters and backslashes: %j", (raw) => {
    expect(sanitizeNextUrl(raw)).toBeNull();
  });

  it("rejects every C0 control character anywhere", () => {
    for (let code = 0; code < 0x20; code++) {
      expect(sanitizeNextUrl(`/${String.fromCharCode(code)}/evil.com`)).toBeNull();
    }
  });
});

describe("isReservedSlug", () => {
  it("knows generated list", () => {
    expect(isReservedSlug("login")).toBe(true);
    expect(isReservedSlug("verify")).toBe(true);
    expect(isReservedSlug("acme")).toBe(false);
  });
});
