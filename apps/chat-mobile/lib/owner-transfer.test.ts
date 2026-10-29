import { describe, expect, it } from "vitest";
import { TRANSFER_OWNERSHIP_HANDLED_CODES, transferCandidates, transferOwnershipFailure } from "./owner-transfer";

const refusal = (code: string, status = 403) => ({ status, body: { error: { code, message: "x" } } });

describe("transferCandidates", () => {
  it("offers every other active member, admins first, keeping the server's name order", () => {
    const members = [
      { user_id: "u-self", display_name: "An", email: "an@acme.vn", role: "owner" },
      { user_id: "u-binh", display_name: "Bình", email: "binh@acme.vn", role: "member" },
      { user_id: "u-chi", display_name: "Chi", email: "chi@acme.vn", role: "admin" },
      { user_id: "u-dung", display_name: "", email: "dung@acme.vn", role: "member" },
      { user_id: "u-gone", display_name: "Gone", email: "gone@acme.vn", role: "admin", deactivated_at: "2026-10-01T00:00:00Z" },
      { user_id: "u-old", display_name: "Old", email: "old@acme.vn", role: "member", deactivated_at: null },
    ];
    expect(transferCandidates(members, "U-SELF")).toEqual([
      { userId: "u-chi", name: "Chi", email: "chi@acme.vn", admin: true },
      { userId: "u-binh", name: "Bình", email: "binh@acme.vn", admin: false },
      // No display name: the address names them.
      { userId: "u-dung", name: "dung@acme.vn", email: "dung@acme.vn", admin: false },
      { userId: "u-old", name: "Old", email: "old@acme.vn", admin: false },
    ]);
    expect(transferCandidates([], "u-self")).toEqual([]);
  });
});

describe("transferOwnershipFailure", () => {
  it("names what the person can act on, and nothing else", () => {
    // The one chosen left, was switched off, or is no longer in the organization.
    expect(transferOwnershipFailure(refusal("member_deactivated"))).toBe("member_gone");
    expect(transferOwnershipFailure(refusal("not_found", 404))).toBe("member_gone");
    expect(transferOwnershipFailure({ status: 429 })).toBe("rate_limited");
    expect(transferOwnershipFailure({ status: 0 })).toBe("offline");
    expect(transferOwnershipFailure(refusal("forbidden"))).toBe("failed");
    expect(transferOwnershipFailure(new Error("boom"))).toBe("failed");
  });

  it("lists the codes the sheet answers itself", () => {
    expect([...TRANSFER_OWNERSHIP_HANDLED_CODES].sort()).toEqual(["member_deactivated", "not_found", "proof_required"]);
  });
});
