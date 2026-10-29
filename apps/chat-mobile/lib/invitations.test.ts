import { describe, expect, it } from "vitest";
import {
  daysLeft,
  expiresSoon,
  goneReason,
  invitationWorkspaceNames,
  inviteErrorHintKey,
  inviteErrorKey,
  inviteErrorRetries,
  inviteRefusal,
  previewState,
  roleKey,
  type InviteErrorReason,
} from "./invitations";

const refusal = (code: string | undefined, status: number) => Object.assign(new Error(code ?? "x"), { status, body: { error: { code } } });
const NOW = Date.parse("2026-10-28T09:00:00Z");

describe("inviteRefusal", () => {
  it("reads another organization in the way as the web's switch", () => {
    expect(inviteRefusal(refusal("organization_switch_required", 409))).toEqual({ kind: "switch" });
  });

  it("reads an invitation that no longer works by its 410", () => {
    expect(inviteRefusal(refusal("invitation_expired", 410))).toEqual({ kind: "gone", reason: "expired" });
    expect(inviteRefusal(refusal("invitation_revoked", 410))).toEqual({ kind: "gone", reason: "revoked" });
    expect(inviteRefusal(refusal("invitation_accepted", 410))).toEqual({ kind: "gone", reason: "accepted" });
  });

  it("names each refusal the server words", () => {
    const cases: [string, number, InviteErrorReason][] = [
      ["not_found", 404, "gone"],
      ["member_deactivated", 403, "deactivated"],
      ["invitation_email_mismatch", 403, "wrongAccount"],
      ["email_unverified", 403, "unverified"],
      ["organization_suspended", 403, "suspended"],
      ["organization_deletion_scheduled", 403, "deletionScheduled"],
      ["membership_busy", 409, "busy"],
    ];
    for (const [code, status, reason] of cases) expect(inviteRefusal(refusal(code, status))).toEqual({ kind: "error", reason });
  });

  it("falls back on the status, then on failed", () => {
    expect(inviteRefusal(refusal(undefined, 404))).toEqual({ kind: "error", reason: "gone" });
    expect(inviteRefusal(refusal("rate_limited", 429))).toEqual({ kind: "error", reason: "rateLimited" });
    expect(inviteRefusal(refusal(undefined, 0))).toEqual({ kind: "error", reason: "offline" });
    expect(inviteRefusal(refusal("internal", 500))).toEqual({ kind: "error", reason: "failed" });
    expect(inviteRefusal(new TypeError("boom"))).toEqual({ kind: "error", reason: "failed" });
  });
});

describe("the words of a refusal", () => {
  it("says the network and the rate limit as the rest of the app does, the rest in the web's words", () => {
    expect(inviteErrorKey("rateLimited")).toBe("mobile.account.rate_limited");
    expect(inviteErrorKey("offline")).toBe("mobile.account.offline");
    expect(inviteErrorKey("busy")).toBe("invitations.switch.busy");
    expect(inviteErrorKey("wrongAccount")).toBe("workspace.acceptInviteError.wrongAccount");
  });

  it("adds what to do next only where there is something beyond trying again", () => {
    expect(inviteErrorHintKey("gone")).toBe("workspace.acceptInviteError.hint");
    expect(inviteErrorHintKey("wrongAccount")).toBe("workspace.acceptInviteError.wrongAccountHint");
    for (const reason of ["suspended", "deletionScheduled", "deactivated"] as const) {
      expect(inviteErrorHintKey(reason)).toBe("workspace.acceptInviteError.askInviterHint");
    }
    expect(inviteErrorHintKey("failed")).toBeNull();
  });

  it("offers to try again only after a blip", () => {
    expect(["rateLimited", "busy", "offline", "failed"].every((r) => inviteErrorRetries(r as InviteErrorReason))).toBe(true);
    expect(inviteErrorRetries("gone")).toBe(false);
    expect(inviteErrorRetries("wrongAccount")).toBe(false);
  });
});

describe("goneReason", () => {
  it("reads a preview's status and an accept's code alike, and nothing else", () => {
    expect(goneReason("expired")).toBe("expired");
    expect(goneReason("revoked")).toBe("revoked");
    expect(goneReason("accepted")).toBe("accepted");
    expect(goneReason("pending")).toBeNull();
    expect(goneReason(undefined)).toBeNull();
  });
});

describe("previewState", () => {
  const preview = (status: string, conflicts: unknown[] = []) => ({
    invitation: { id: "i", status, expires_at: "", organization: { id: "o", slug: "o", name: "O" }, workspaces: [], org_role: "member" },
    conflicts: conflicts as never[],
  });

  it("asks for the web's switch while the account still belongs to another organization", () => {
    expect(previewState(preview("pending"))).toEqual({ kind: "pending", switchFirst: false });
    expect(previewState(preview("pending", [{ organization: { id: "x", slug: "x", name: "X" }, role: "owner", required_action: "transfer" }]))).toEqual({
      kind: "pending",
      switchFirst: true,
    });
  });

  it("shows an invitation that no longer works as gone; an unknown status reads as pending", () => {
    expect(previewState(preview("revoked"))).toEqual({ kind: "gone", reason: "revoked" });
    expect(previewState(preview("frozen"))).toEqual({ kind: "pending", switchFirst: false });
  });
});

describe("invitationWorkspaceNames", () => {
  it("names every workspace joining grants, else the one it was sent from, else none", () => {
    const hq = { id: "w1", slug: "hq", name: "HQ" };
    expect(invitationWorkspaceNames({ workspaces: [hq, { id: "w2", slug: "ops", name: "Ops" }] })).toEqual(["HQ", "Ops"]);
    expect(invitationWorkspaceNames({ workspace: hq, workspaces: [] })).toEqual(["HQ"]);
    expect(invitationWorkspaceNames({ workspaces: [] })).toEqual([]);
  });
});

describe("expiry", () => {
  it("counts whole days left, at least one while it runs", () => {
    expect(daysLeft("2026-11-04T09:00:00Z", NOW)).toBe(7);
    expect(daysLeft("2026-10-28T10:00:00Z", NOW)).toBe(1);
    expect(daysLeft("2026-10-27T09:00:00Z", NOW)).toBeNull();
    expect(daysLeft("soon", NOW)).toBeNull();
  });

  it("flags the last two days", () => {
    expect(expiresSoon("2026-10-29T09:00:00Z", NOW)).toBe(true);
    expect(expiresSoon("2026-11-04T09:00:00Z", NOW)).toBe(false);
    expect(expiresSoon("2026-10-27T09:00:00Z", NOW)).toBe(false);
    expect(expiresSoon("", NOW)).toBe(false);
  });
});

describe("roleKey", () => {
  it("names the three organization roles and leaves an unknown one as it came", () => {
    expect(roleKey("owner")).toBe("people.role_owner");
    expect(roleKey("admin")).toBe("people.role_admin");
    expect(roleKey("member")).toBe("people.role_member");
    expect(roleKey("guest")).toBeNull();
  });
});
