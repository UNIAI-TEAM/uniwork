import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { create, createWorkspace, getPushPreviewPolicy, list, listWorkspaces, setPushPreviewPolicy } from "./organizations";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const org = { id: "o1", slug: "acme", name: "Acme", role: "owner" };
const ws = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1",
  organization_slug: "acme", organization_name: "Acme",
};

describe("organizations endpoints", () => {
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

  it("list returns organizations, [] on drift, and lets an unknown role through", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ organizations: [{ ...org, role: "billing" }] }));
    const [o] = await list();
    expect(o?.role).toBe("billing");
    vi.mocked(fetch).mockResolvedValueOnce(json({ organizations: [{ slug: 1 }] }));
    await expect(list()).resolves.toEqual([]);
  });

  it("list keeps the deactivated flag, so a switched-off membership is not counted as held", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ organizations: [{ ...org, deactivated: true }, org] }));
    const [off, on] = await list();
    expect(off?.deactivated).toBe(true);
    expect(on?.deactivated).toBeUndefined();
  });

  it("create posts the body and returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ organization: org }));
    expect((await create({ name: "Acme", slug: "acme" }))?.id).toBe("o1");
    expect(vi.mocked(fetch).mock.calls[0]![1]!.method).toBe("POST");
    vi.mocked(fetch).mockResolvedValueOnce(json({ organization: {} }));
    await expect(create({ name: "Acme", slug: "acme" })).resolves.toBeNull();
  });

  it("listWorkspaces / createWorkspace scope to the org id", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ workspaces: [ws] }))
      .mockResolvedValueOnce(json({ workspace: ws }))
      .mockResolvedValueOnce(json({ workspaces: "nope" }));
    expect(await listWorkspaces("o1")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/orgs/o1/workspaces");
    expect((await createWorkspace("o1", { name: "Team", slug: "team" }))?.slug).toBe("team");
    await expect(listWorkspaces("o1")).resolves.toEqual([]);
  });

  it("reads and sets the organization's push preview policy, and a malformed answer degrades to the default", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ hidden: true, hidden_at: "2026-10-22T08:00:00Z", can_manage: true }));
    await expect(getPushPreviewPolicy("acme co")).resolves.toEqual({ hidden: true, hidden_at: "2026-10-22T08:00:00Z", can_manage: true });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("http://api.test/api/v1/orgs/acme%20co/push-preview-policy");
    vi.mocked(fetch).mockResolvedValueOnce(json({ hidden: "yes", can_manage: 1 }));
    await expect(getPushPreviewPolicy("acme")).resolves.toEqual({ hidden: false, hidden_at: null, can_manage: false });
    vi.mocked(fetch).mockResolvedValueOnce(json([]));
    await expect(getPushPreviewPolicy("acme")).resolves.toEqual({ hidden: false, hidden_at: null, can_manage: false });

    vi.mocked(fetch).mockResolvedValueOnce(json({ hidden: true, hidden_at: "x", can_manage: true }));
    await expect(setPushPreviewPolicy("acme", true)).resolves.toMatchObject({ hidden: true });
    const [, init] = vi.mocked(fetch).mock.calls.at(-1) as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ hidden: true });
    // A drifted answer to a write the server took reads as what was asked.
    vi.mocked(fetch).mockResolvedValueOnce(json("<html>"));
    await expect(setPushPreviewPolicy("acme", true)).resolves.toEqual({ hidden: true, hidden_at: null, can_manage: true });
  });
});
