import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { createTaskView, getTaskViewPreference, listPins, listTaskViews } from "./task-views";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const view = {
  id: "v1",
  organization_id: "o1",
  workspace_id: "ws1",
  owner_id: "u1",
  name: "Backlog",
  scope_type: "workspace",
  scope_id: null,
  scope_variant: null,
  visibility: "private",
  definition_version: 1,
  query: {},
  display: {},
  revision: 1,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
};

describe("task-views endpoints", () => {
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

  it("listTaskViews returns views and empty on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ views: [view], total: 1 }));
    expect((await listTaskViews("ws1", { scope_type: "workspace" })).views[0]?.name).toBe(
      "Backlog",
    );
    vi.mocked(fetch).mockResolvedValueOnce(json({ views: [{ id: 1 }] }));
    await expect(listTaskViews("ws1")).resolves.toEqual({ views: [], total: 0 });
  });

  it("createTaskView returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ view: { nope: true } }));
    await expect(
      createTaskView("ws1", {
        name: "X",
        scope_type: "workspace",
        visibility: "private",
      }),
    ).resolves.toBeNull();
  });

  it("getTaskViewPreference / listPins degrade on malformed", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ scope_type: 1 }))
      .mockResolvedValueOnce(json({ pins: "x" }));
    await expect(
      getTaskViewPreference("ws1", { scope_type: "workspace" }),
    ).resolves.toBeNull();
    await expect(listPins("ws1")).resolves.toEqual({ pins: [], total: 0 });
  });
});
