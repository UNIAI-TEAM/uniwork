import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { acceptInvite, getBySlugs, getMyMembership, invite, list, listMembers, myInvitations, patchWorkspace } from "./workspaces";

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
});
