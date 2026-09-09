import { describe, expect, it } from "vitest";
import { isReservedSlug, paths, pendingAuthStep, resolvePostAuthDestination, sanitizeNextUrl } from "./index";
import type { Workspace } from "../types";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";

const ws = (org: string, slug: string): Workspace => ({
  id: slug, slug, name: slug, organization_id: org, organization_slug: org, organization_name: org,
});

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
});

describe("paths", () => {
  it("builds workspace urls", () => {
    expect(paths.workspace("unicom", "alpha").task("T1")).toBe("/unicom/alpha/tasks/T1");
    expect(paths.workspace("unicom", "alpha").room("M1")).toBe("/unicom/alpha/meetings/M1/room");
  });
  it("builds my-tasks under the workspace", () => {
    expect(paths.workspace("acme", "team").myTasks()).toBe("/acme/team/my-tasks");
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
      expect(paths.googleStart("/acme/team")).toBe("http://api.test/api/v1/auth/google/start?next=%2Facme%2Fteam");
      expect(paths.googleStart(null)).toBe("http://api.test/api/v1/auth/google/start");
    } finally {
      resetRuntimeConfig();
    }
  });
});

describe("sanitizeNextUrl", () => {
  it("accepts same-origin paths only", () => {
    expect(sanitizeNextUrl("/invite/abc")).toBe("/invite/abc");
    expect(sanitizeNextUrl("//evil.com")).toBeNull();
    expect(sanitizeNextUrl("https://evil.com")).toBeNull();
    expect(sanitizeNextUrl(null)).toBeNull();
  });
});

describe("isReservedSlug", () => {
  it("knows generated list", () => {
    expect(isReservedSlug("login")).toBe(true);
    expect(isReservedSlug("verify")).toBe(true);
    expect(isReservedSlug("acme")).toBe(false);
  });
});
