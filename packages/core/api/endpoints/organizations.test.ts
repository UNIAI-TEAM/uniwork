import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { create, createWorkspace, list, listWorkspaces } from "./organizations";

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
});
