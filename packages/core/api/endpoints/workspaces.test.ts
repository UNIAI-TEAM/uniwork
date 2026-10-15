import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { invitationWorkspaces } from "../../types";
import { setAccessToken } from "../session";
import {
  acceptInvite,
  getBySlugs,
  getInvitationPreview,
  getMyMembership,
  invite,
  list,
  listMembers,
  myInvitations,
  patchWorkspace,
  removeWorkspaceIcon,
  uploadWorkspaceIcon,
} from "./workspaces";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ws = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1",
  organization_slug: "acme", organization_name: "Acme",
};

describe("workspaces endpoints", () => {
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

  it("list returns [] on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspaces: [ws] }));
    expect(await list()).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspaces: [{ id: "x" }] }));
    await expect(list()).resolves.toEqual([]);
  });

  it("getBySlugs encodes both slugs and returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: ws }));
    expect((await getBySlugs("acme", "team"))?.id).toBe("ws1");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/orgs/acme/workspaces/team");
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: null }));
    await expect(getBySlugs("acme", "team")).resolves.toBeNull();
  });

  it("listMembers lets an unknown role through and drops on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ members: [{ workspace_id: "ws1", user_id: "u1", role: "guest", email: "a@b.c", display_name: "A" }] }),
    );
    const [m] = await listMembers("ws1");
    expect(m?.role).toBe("guest");
    vi.mocked(fetch).mockResolvedValueOnce(json({ members: {} }));
    await expect(listMembers("ws1")).resolves.toEqual([]);
  });

  it("invite returns an empty result on drift instead of throwing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ invitations: "nope" }));
    await expect(invite("ws1", { emails: ["a@b.c"], role: "member" })).resolves.toEqual({
      invitations: [],
      skipped: [],
    });
  });

  it("myInvitations degrades to []", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ invitations: [{ id: 1 }] }));
    await expect(myInvitations()).resolves.toEqual([]);
  });

  it("myInvitations keeps an organization-level invitation beside a workspace one", async () => {
    const base = {
      role: "member",
      expires_at: "2026-10-20T00:00:00Z",
      organization: { id: "o1", slug: "acme", name: "Acme" },
      invited_by: { display_name: "An" },
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        invitations: [
          // The server omits `workspace` for an invitation to the organization itself.
          { ...base, id: "i1", token: "t1", org_role: "admin" },
          { ...base, id: "i2", token: "t2", org_role: "member", workspace: { id: "w1", slug: "team", name: "Team" } },
        ],
      }),
    );
    const [orgLevel, wsLevel] = await myInvitations();
    expect(orgLevel?.workspace).toBeUndefined();
    expect(orgLevel?.org_role).toBe("admin");
    expect(wsLevel?.workspace?.slug).toBe("team");
  });

  it("myInvitations reads the workspaces an invitation grants; absent or drifted reads as none", async () => {
    const base = {
      role: "member",
      expires_at: "",
      organization: { id: "o1", slug: "acme", name: "Acme" },
      invited_by: { display_name: "An" },
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        invitations: [
          { ...base, id: "i1", token: "t1", workspaces: [{ id: "w1", slug: "sales", name: "Sales" }, { id: "w2", slug: "ops", name: "Ops" }] },
          { ...base, id: "i2", token: "t2" },
          // One drifted entry must not cost the whole list (or this invitation).
          { ...base, id: "i3", token: "t3", workspaces: [{ id: 3 }] },
          { ...base, id: "i4", token: "t4", workspace: { id: "w9", slug: "team", name: "Team" } },
        ],
      }),
    );
    const [granted, none, drifted, older] = await myInvitations();
    expect(granted?.workspaces.map((w) => w.name)).toEqual(["Sales", "Ops"]);
    expect(none?.workspaces).toEqual([]);
    expect(drifted?.workspaces).toEqual([]);
    // An older server names only `workspace`: the helper still lists it.
    expect(invitationWorkspaces(older!)).toEqual([{ id: "w9", slug: "team", name: "Team" }]);
    expect(invitationWorkspaces(granted!).map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(invitationWorkspaces(none!)).toEqual([]);
  });

  it("myInvitations reads a missing org_role as member", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        invitations: [
          {
            id: "i1", role: "member", token: "t1", expires_at: "",
            organization: { id: "o1", slug: "acme", name: "Acme" },
            invited_by: { display_name: "An" },
          },
        ],
      }),
    );
    const [inv] = await myInvitations();
    expect(inv?.org_role).toBe("member");
  });

  it("acceptInvite reports the organization, and a null workspace for an org-level invitation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ organization: { id: "o1", slug: "acme", name: "Acme" } }),
    );
    const orgOnly = await acceptInvite("tok");
    expect(orgOnly.organization?.slug).toBe("acme");
    expect(orgOnly.workspace).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce(
      json({ organization: { id: "o1", slug: "acme", name: "Acme" }, workspace: ws }),
    );
    expect((await acceptInvite("tok")).workspace?.id).toBe("ws1");

    // A malformed body degrades to "nothing joined" rather than throwing.
    vi.mocked(fetch).mockResolvedValueOnce(json({ organization: { id: 1 } }));
    await expect(acceptInvite("tok")).resolves.toEqual({ organization: null, workspace: null });
  });

  it("acceptInvite sends no body without a resolve, and the resolve when given", async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ organization: { id: "o2", slug: "beta", name: "Beta" } }));
    await acceptInvite("tok");
    await acceptInvite("tok", []);
    const resolve = [{ organization_id: "o1", action: "transfer" as const, transfer_to_user_id: "u2", password: "pw" }];
    await acceptInvite("t/k", resolve);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0]![1]?.body).toBeUndefined();
    // An empty resolve is the plain accept: the body stays off the wire.
    expect(calls[1]![1]?.body).toBeUndefined();
    expect(calls[2]![0]).toBe("http://api.test/api/v1/invitations/t%2Fk/accept");
    expect(calls[2]![1]?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]![1]?.body))).toEqual({ resolve });
  });

  describe("getInvitationPreview", () => {
    const preview = {
      invitation: {
        id: "i1",
        status: "pending",
        expires_at: "2026-10-20T00:00:00Z",
        organization: { id: "o2", slug: "beta", name: "Beta" },
        workspace: { id: "w2", slug: "team", name: "Team" },
        org_role: "member",
        inviter_name: "An",
      },
      conflicts: [
        {
          organization: { id: "o1", slug: "acme", name: "Acme" },
          role: "owner",
          required_action: "transfer",
          transfer_candidates_count: 2,
        },
      ],
    };

    it("reads the invitation and its conflicts from the token's URL", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json(preview));
      const out = await getInvitationPreview("t/k");
      expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/invitations/t%2Fk");
      expect(out?.invitation.organization.name).toBe("Beta");
      expect(out?.invitation.workspace?.slug).toBe("team");
      expect(out?.conflicts[0]).toMatchObject({ required_action: "transfer", transfer_candidates_count: 2 });
    });

    it("lets unknown enum values through and reads omitted keys as absent", async () => {
      const { workspace: _ws, inviter_name: _name, ...orgLevel } = preview.invitation;
      vi.mocked(fetch).mockResolvedValueOnce(
        json({
          invitation: { ...orgLevel, status: "paused" },
          conflicts: [{ ...preview.conflicts[0], required_action: "later", transfer_candidates_count: undefined }],
        }),
      );
      const out = await getInvitationPreview("tok");
      expect(out?.invitation.status).toBe("paused");
      expect(out?.invitation.workspace).toBeUndefined();
      expect(out?.invitation.inviter_name).toBeUndefined();
      expect(out?.conflicts[0]).toMatchObject({ required_action: "later", transfer_candidates_count: 0 });
    });

    it("lists the workspaces accepting grants, and none when the key is absent", async () => {
      const { workspace: _ws, ...orgLevel } = preview.invitation;
      vi.mocked(fetch).mockResolvedValueOnce(
        json({ invitation: { ...orgLevel, workspaces: [{ id: "w3", slug: "sales", name: "Sales" }] }, conflicts: [] }),
      );
      const out = await getInvitationPreview("tok");
      expect(out?.invitation.workspaces).toEqual([{ id: "w3", slug: "sales", name: "Sales" }]);
      vi.mocked(fetch).mockResolvedValueOnce(json({ invitation: orgLevel, conflicts: [] }));
      expect((await getInvitationPreview("tok"))?.invitation.workspaces).toEqual([]);
    });

    it("reads a missing conflicts list as none", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ invitation: preview.invitation }));
      expect((await getInvitationPreview("tok"))?.conflicts).toEqual([]);
    });

    it("degrades a malformed response to null instead of throwing", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ invitation: { id: 1 } }));
      await expect(getInvitationPreview("tok")).resolves.toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json("nope"));
      await expect(getInvitationPreview("tok")).resolves.toBeNull();
    });
  });

  it("patchWorkspace returns workspace or null on malformed response", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ workspace: { ...ws, name: "Renamed" } }))
      .mockResolvedValueOnce(json({ nope: true }));
    expect((await patchWorkspace("ws1", { name: "Renamed" }))?.name).toBe("Renamed");
    await expect(patchWorkspace("ws1", { name: "Renamed" })).resolves.toBeNull();
  });

  it("getMyMembership returns membership or null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ membership: { user_id: "u1", role: "admin", source: "org_admin" } }),
    );
    expect(await getMyMembership("ws1")).toEqual({
      user_id: "u1",
      role: "admin",
      source: "org_admin",
    });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws1/me");
    vi.mocked(fetch).mockResolvedValueOnce(json({ membership: null }));
    await expect(getMyMembership("ws1")).resolves.toBeNull();
  });

  it("patchWorkspace sends only the fields it is given", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: { ...ws, description: "Mô tả", icon_emoji: "🚀" } }));
    const got = await patchWorkspace("ws1", { description: "Mô tả", icon_emoji: "🚀" });
    expect(got?.description).toBe("Mô tả");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual({ description: "Mô tả", icon_emoji: "🚀" });
  });

  it("parses a workspace from a server that does not send the profile fields", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: ws }));
    const got = await getBySlugs("acme", "team");
    expect(got?.id).toBe("ws1");
    expect(got?.description).toBeUndefined();
    expect(got?.icon_url).toBeUndefined();
  });

  it("drops a profile field of the wrong type instead of dropping the workspace", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: { ...ws, description: 42, icon_url: null } }));
    const got = await getBySlugs("acme", "team");
    expect(got?.id).toBe("ws1");
    expect(got?.description).toBeUndefined();
    expect(got?.icon_url).toBeUndefined();
  });

  it("uploadWorkspaceIcon posts multipart and returns the workspace or null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: { ...ws, icon_url: "https://cdn/i.png" } }));
    const file = new File(["x"], "i.png", { type: "image/png" });
    expect((await uploadWorkspaceIcon("ws1", file))?.icon_url).toBe("https://cdn/i.png");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/workspaces/ws1/icon");
    expect(init.body).toBeInstanceOf(FormData);
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(uploadWorkspaceIcon("ws1", file)).resolves.toBeNull();
  });

  it("removeWorkspaceIcon sends DELETE and returns the workspace or null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ workspace: ws }));
    expect((await removeWorkspaceIcon("ws1"))?.id).toBe("ws1");
    expect(vi.mocked(fetch).mock.calls[0]![1]!.method).toBe("DELETE");
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(removeWorkspaceIcon("ws1")).resolves.toBeNull();
  });
});
