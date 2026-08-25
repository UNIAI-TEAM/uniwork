import { describe, expect, it, vi } from "vitest";
import { resolveLoggedInDestination } from "./post-auth-redirect";

const fetchMy = vi.fn();
vi.mock("@uniwork/core/workspaces", () => ({ fetchMyInvitations: (...a: unknown[]) => fetchMy(...a) }));

describe("resolveLoggedInDestination", () => {
  it("un-onboarded with pending invites → /invitations", async () => {
    fetchMy.mockResolvedValueOnce([{ id: "i" }]);
    expect(await resolveLoggedInDestination(false, [])).toBe("/invitations");
  });
  it("un-onboarded without invites → /onboarding; fetch failure non-fatal", async () => {
    fetchMy.mockRejectedValueOnce(new Error("x"));
    expect(await resolveLoggedInDestination(false, [])).toBe("/onboarding");
  });
  it("onboarded → never checks invites", async () => {
    fetchMy.mockClear();
    expect(await resolveLoggedInDestination(true, [])).toBe("/workspaces/new");
    expect(fetchMy).not.toHaveBeenCalled();
  });
});
