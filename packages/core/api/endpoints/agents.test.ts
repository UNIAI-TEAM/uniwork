import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { listWorkspaceAgents } from "./agents";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validAgent = {
  id: "a1", organization_id: "o1", name: "UNI", handle: "uni", status: "active", owner_user_id: "u1",
};

describe("agents endpoints", () => {
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

  it("listWorkspaceAgents returns the agents", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ agents: [validAgent] }));
    const agents = await listWorkspaceAgents("ws1");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.description).toBe("");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws1/agents");
  });

  it("listWorkspaceAgents returns [] instead of throwing on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ agents: [{ id: 1 }] }));
    await expect(listWorkspaceAgents("ws1")).resolves.toEqual([]);
  });

  it("listWorkspaceAgents lets an unknown status through", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ agents: [{ ...validAgent, status: "sleeping" }] }));
    expect(await listWorkspaceAgents("ws1")).toHaveLength(1);
  });
});
