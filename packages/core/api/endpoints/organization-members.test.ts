import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  closeOrganization,
  deactivateOrgMember,
  inviteToOrganization,
  listOrgInvitations,
  revokeOrgInvitation,
  transferOwnership,
  getOrgMembership,
  leaveOrganization,
  listOrgMembers,
  reactivateOrgMember,
  updateOrgMemberRole,
} from "./organization-members";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validMember = { user_id: "u1", role: "member" };

describe("organization member endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("listOrgMembers passes status and cursor and defaults the identity columns", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ members: [validMember], next_cursor: "c2" }));
    const page = await listOrgMembers("acme", "all", "c1");
    expect(page.members[0]!.display_name).toBe("");
    expect(page.next_cursor).toBe("c2");
    const url = String(vi.mocked(fetch).mock.calls[0]![0]);
    expect(url).toContain("status=all");
    expect(url).toContain("cursor=c1");
  });

  it("listOrgMembers degrades to an empty page on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ members: [{ user_id: 3 }] }));
    await expect(listOrgMembers("acme")).resolves.toEqual({ members: [] });
  });

  it("getOrgMembership returns the row even while deactivated, and null when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ role: "member", deactivated_at: "2026-09-07T09:00:00Z" }));
    const me = await getOrgMembership("acme");
    expect(me?.deactivated_at).toBe("2026-09-07T09:00:00Z");

    vi.mocked(fetch).mockResolvedValueOnce(json({ role: 5 }));
    await expect(getOrgMembership("acme")).resolves.toBeNull();
  });

  it("the write endpoints return null on a malformed response", async () => {
    for (const call of [
      () => updateOrgMemberRole("acme", "u1", "admin"),
      () => deactivateOrgMember("acme", "u1"),
      () => reactivateOrgMember("acme", "u1"),
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(json({ member: { user_id: 1 } }));
      await expect(call()).resolves.toBeNull();
    }
  });

  it("listOrgInvitations and inviteToOrganization degrade to an empty result", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ invitations: [{ id: "i1", email: "an@acme.vn", org_role: "member" }], skipped: ["x"] }),
    );
    const listed = await listOrgInvitations("acme");
    expect(listed.invitations[0]!.expires_at).toBe("");
    expect(listed.skipped).toEqual(["x"]);

    vi.mocked(fetch).mockResolvedValueOnce(json({ invitations: [{ id: 1 }] }));
    await expect(inviteToOrganization("acme", ["an@acme.vn"], "member")).resolves.toEqual({
      invitations: [],
      skipped: [],
    });
    expect(vi.mocked(fetch).mock.calls[1]![1]).toMatchObject({ method: "POST" });
  });

  it("inviteToOrganization sends the chosen workspaces, and every list reads the ones granted", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        invitations: [
          { id: "i1", email: "an@acme.vn", org_role: "member", workspaces: [{ id: "w1", slug: "sales", name: "Sales" }] },
        ],
        skipped: [],
      }),
    );
    const sent = await inviteToOrganization("acme", ["an@acme.vn"], "member", ["w1"]);
    expect(sent.invitations[0]!.workspaces).toEqual([{ id: "w1", slug: "sales", name: "Sales" }]);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toEqual({
      emails: ["an@acme.vn"],
      org_role: "member",
      workspace_ids: ["w1"],
    });

    // Older servers omit the key; a drifted list costs only itself.
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        invitations: [
          { id: "i1", email: "an@acme.vn", org_role: "member" },
          { id: "i2", email: "binh@acme.vn", org_role: "member", workspaces: "sales" },
        ],
      }),
    );
    const listed = await listOrgInvitations("acme");
    expect(listed.invitations.map((i) => i.workspaces)).toEqual([[], []]);
  });

  it("inviteToOrganization without workspaces sends an empty choice", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ invitations: [], skipped: [] }));
    await inviteToOrganization("acme", ["an@acme.vn"], "member");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({ workspace_ids: [] });
  });

  it("revokeOrgInvitation and transferOwnership report failure rather than throwing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: 1 }));
    await expect(revokeOrgInvitation("acme", "i1")).resolves.toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(json({ member: { user_id: 1 } }));
    await expect(transferOwnership("acme", "u2", "pw")).resolves.toBeNull();
    // The password goes in the body, never in the URL.
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).not.toContain("pw");
  });

  it("transferOwnership surfaces a wrong re-entered password once, without a session refresh", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "password_incorrect", message: "mật khẩu không đúng" } }, 403),
    );
    await expect(transferOwnership("acme", "u2", "wrong")).rejects.toMatchObject({
      code: "password_incorrect",
      status: 403,
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("leaveOrganization reports failure rather than throwing on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await expect(leaveOrganization("acme")).resolves.toBe(true);
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: 1 }));
    await expect(leaveOrganization("acme")).resolves.toBe(false);
  });

  it("closeOrganization posts the typed slug and reports failure rather than throwing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await expect(closeOrganization("acme", "acme")).resolves.toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/orgs/acme/close");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init!.body))).toEqual({ confirm_slug: "acme" });

    vi.mocked(fetch).mockResolvedValueOnce(json({ status: 1 }));
    await expect(closeOrganization("acme", "acme")).resolves.toBe(false);
  });

  it("closeOrganization surfaces a refusal as an ApiError carrying its code", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "organization_has_members", message: "x" } }, 409),
    );
    await expect(closeOrganization("acme", "acme")).rejects.toMatchObject({
      code: "organization_has_members",
      status: 409,
    });
  });
});
