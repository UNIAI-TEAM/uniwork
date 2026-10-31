import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLinkStep, pastLinkStep, resolveLoggedInDestination as resolveWith } from "./post-auth-redirect";

const fetchMy = vi.fn();
vi.mock("@uniwork/core/workspaces", () => ({
  fetchMyInvitations: (...a: unknown[]) => fetchMy(...a),
  workspaceKeys: { myInvitations: () => ["my-invitations"] },
}));
const fetchOrgs = vi.fn();
vi.mock("@uniwork/core/organizations", () => ({
  fetchOrganizations: (...a: unknown[]) => fetchOrgs(...a),
  organizationKeys: { list: () => ["organizations"] },
}));

// The app's defaults (createQueryClient): a 15s staleTime and one retry,
// which the lookups must override so sign-in never waits on a retry.
let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });
});
const resolveLoggedInDestination = (user: Parameters<typeof resolveWith>[0], ws: Parameters<typeof resolveWith>[1]) =>
  resolveWith(user, ws, qc);

const verified = { email_verified_at: "2026-08-27T00:00:00Z", onboarded_at: null };
const onboarded = { email_verified_at: "2026-08-27T00:00:00Z", onboarded_at: "2026-08-27T00:00:00Z" };
const unverified = { email_verified_at: null, onboarded_at: null };

describe("resolveLoggedInDestination", () => {
  it("unverified → /verify before anything else, without checking invites", async () => {
    fetchMy.mockClear();
    expect(await resolveLoggedInDestination(unverified, [])).toBe("/verify");
    expect(fetchMy).not.toHaveBeenCalled();
  });
  it("un-onboarded with pending invites → /invitations", async () => {
    fetchMy.mockResolvedValueOnce([{ id: "i" }]);
    expect(await resolveLoggedInDestination(verified, [])).toBe("/invitations");
  });
  it("un-onboarded without invites → /onboarding; fetch failure non-fatal", async () => {
    fetchMy.mockRejectedValueOnce(new Error("x"));
    expect(await resolveLoggedInDestination(verified, [])).toBe("/onboarding");
  });
  it("onboarded → never checks invites", async () => {
    fetchMy.mockClear();
    fetchOrgs.mockResolvedValueOnce([{ id: "o1", status: "active", role: "owner" }]);
    expect(await resolveLoggedInDestination(onboarded, [])).toBe("/workspaces/new");
    expect(fetchMy).not.toHaveBeenCalled();
  });
  /**
   * UNI-1472 on a fresh sign-in: a member whose invitation opened no
   * workspace gets the same answer as right after the accept - told to wait
   * for one, never sent to create an organization or a workspace.
   */
  it("a plain member with no workspace → /no-workspace", async () => {
    fetchOrgs.mockResolvedValueOnce([{ id: "o1", status: "active", role: "member" }]);
    expect(await resolveLoggedInDestination(onboarded, [])).toBe("/no-workspace");
  });
  it("a member with a workspace in the organization lands in it", async () => {
    fetchOrgs.mockResolvedValueOnce([{ id: "o1", status: "active", role: "member" }]);
    const ws = { id: "w1", slug: "sales", name: "Sales", organization_id: "o1", organization_slug: "beta", organization_name: "Beta" };
    expect(await resolveLoggedInDestination(onboarded, [ws])).toBe("/beta/sales/tasks");
  });
  it("onboarded without any organization → /get-started (ADR 0032 D12)", async () => {
    fetchOrgs.mockResolvedValueOnce([]);
    expect(await resolveLoggedInDestination(onboarded, [])).toBe("/get-started");
  });
  it("an organization list that fails to load does not block sign-in", async () => {
    fetchOrgs.mockRejectedValueOnce(new Error("x"));
    expect(await resolveLoggedInDestination(onboarded, [])).toBe("/workspaces/new");
  });
  it("the gates never wait on the organization list", async () => {
    fetchOrgs.mockClear();
    await resolveLoggedInDestination(unverified, []);
    expect(fetchOrgs).not.toHaveBeenCalled();
  });

  /** The next screen reads the same keys, so it opens on this answer instead of asking again. */
  it("leaves the invitations it found in the cache for /invitations", async () => {
    const invites = [{ id: "i" }];
    fetchMy.mockResolvedValueOnce(invites);
    expect(await resolveLoggedInDestination(verified, [])).toBe("/invitations");
    expect(qc.getQueryData(["my-invitations"])).toBe(invites);
  });
  it("leaves the organization list in the cache for /get-started", async () => {
    const orgs: unknown[] = [];
    fetchOrgs.mockResolvedValueOnce(orgs);
    expect(await resolveLoggedInDestination(onboarded, [])).toBe("/get-started");
    expect(qc.getQueryData(["organizations"])).toBe(orgs);
  });
  it("asks the server even when an earlier answer is cached, and does not retry a failure", async () => {
    qc.setQueryData(["my-invitations"], [{ id: "stale" }]);
    fetchMy.mockClear();
    fetchMy.mockRejectedValueOnce(new Error("x"));
    expect(await resolveLoggedInDestination(verified, [])).toBe("/onboarding");
    expect(fetchMy).toHaveBeenCalledTimes(1);
  });
});

describe("resolveLoggedInDestination with next", () => {
  const consent = "/auth/desktop/authorize?attempt_id=a1";
  const linkStep = "/auth/continue?step=link&next=%2Facme%2Fteam";

  it("carries next through /verify", async () => {
    expect(await resolveWith(unverified, [], qc, "/invite/tok")).toBe("/verify?next=%2Finvite%2Ftok");
  });
  it("carries next through /onboarding", async () => {
    fetchMy.mockResolvedValueOnce([]);
    expect(await resolveWith(verified, [], qc, "/invite/meeting/m1")).toBe("/onboarding?next=%2Finvite%2Fmeeting%2Fm1");
  });
  /** UNI-2226: accepting onboards the person; onboarding first would have them create an organization. */
  it.each(["/join/l1#secret=s3cret", "/invite/tok"])("lets %s go before onboarding, never before /verify", async (next) => {
    fetchMy.mockResolvedValueOnce([]);
    expect(await resolveWith(verified, [], qc, next)).toBe(next);
    expect(await resolveWith(unverified, [], qc, next)).toBe(`/verify?next=${encodeURIComponent(next)}`);
  });
  it("goes to next once the gates are behind the person", async () => {
    fetchOrgs.mockResolvedValueOnce([{ id: "o1", status: "active", role: "owner" }]);
    expect(await resolveWith(onboarded, [], qc, "/acme/team/documents/d1")).toBe("/acme/team/documents/d1");
  });
  it("lets next win over the invitations list, as it always has", async () => {
    fetchMy.mockResolvedValueOnce([{ id: "i" }]);
    expect(await resolveWith(verified, [], qc, "/invite/tok")).toBe("/invite/tok");
  });

  /** Spec §4.2: the app handles an account that owes a gate step; the link step only links. */
  it.each([consent, linkStep])("lets %s through even while a gate is owed", async (next) => {
    fetchMy.mockClear();
    fetchOrgs.mockClear();
    expect(await resolveWith(unverified, [], qc, next)).toBe(next);
    expect(await resolveWith(verified, [], qc, next)).toBe(next);
    // Nothing to look up when the answer is already known.
    expect(fetchMy).not.toHaveBeenCalled();
    expect(fetchOrgs).not.toHaveBeenCalled();
  });

  it.each(["/auth/continue", "/auth/continue?step=create", "/auth/desktop/authorize-not", "/auth/connect/authorize?attempt=a"])(
    "sends %s through the gates like any other page",
    async (next) => {
      expect(await resolveWith(unverified, [], qc, next)).toBe(`/verify?next=${encodeURIComponent(next)}`);
    },
  );

  it.each(["//evil.example/x", "https://evil.example/x", "/\\evil.example", "javascript:alert(1)", "/a b"])(
    "never follows an unsafe next (%s)",
    async (next) => {
      expect(await resolveWith(unverified, [], qc, next)).toBe("/verify");
      fetchOrgs.mockResolvedValueOnce([]);
      expect(await resolveWith(onboarded, [], qc, next)).toBe("/get-started");
    },
  );
});

describe("the link step as a next (spec §4.4)", () => {
  const linkStep = "/auth/continue?step=link&next=%2Finvite%2Ft1";

  it("knows the link step from any other next", () => {
    expect(isLinkStep(linkStep)).toBe(true);
    expect(isLinkStep("/auth/continue?next=%2Fx")).toBe(false);
    expect(isLinkStep("/auth/continue?step=create")).toBe(false);
    expect(isLinkStep("/invite/t1")).toBe(false);
    expect(isLinkStep(null)).toBe(false);
  });

  it("goes past it to its own next, sanitized again, and leaves any other next alone", () => {
    expect(pastLinkStep(linkStep)).toBe("/invite/t1");
    expect(pastLinkStep("/auth/continue?step=link")).toBeNull();
    expect(pastLinkStep("/auth/continue?step=link&next=https%3A%2F%2Fevil.example")).toBeNull();
    expect(pastLinkStep("/acme/team")).toBe("/acme/team");
    expect(pastLinkStep(undefined)).toBeNull();
  });
});
