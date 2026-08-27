import { describe, expect, it, vi } from "vitest";
import { resolveLoggedInDestination } from "./post-auth-redirect";

const fetchMy = vi.fn();
vi.mock("@uniwork/core/workspaces", () => ({ fetchMyInvitations: (...a: unknown[]) => fetchMy(...a) }));

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
    expect(await resolveLoggedInDestination(onboarded, [])).toBe("/workspaces/new");
    expect(fetchMy).not.toHaveBeenCalled();
  });
});
