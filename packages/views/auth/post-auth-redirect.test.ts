import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLoggedInDestination as resolveWith } from "./post-auth-redirect";

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
