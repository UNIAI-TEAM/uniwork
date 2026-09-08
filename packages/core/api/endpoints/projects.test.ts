import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  createProject,
  listProjectResources,
  listProjects,
  searchProjects,
} from "./projects";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const project = {
  id: "p1",
  organization_id: "o1",
  workspace_id: "ws1",
  title: "Q3",
  description: "",
  icon: null,
  status: "planned",
  priority: "none",
  lead_type: null,
  lead_id: null,
  start_date: null,
  due_date: null,
  revision: 1,
  task_count: 0,
  done_count: 0,
  resource_count: 0,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
};

describe("projects endpoints", () => {
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

  it("listProjects / searchProjects return lists and empty on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ projects: [project], total: 1 }))
      .mockResolvedValueOnce(json({ projects: [{ id: 1 }] }))
      .mockResolvedValueOnce(json({ projects: [project], total: 1 }))
      .mockResolvedValueOnce(json({ projects: "x" }));
    expect((await listProjects("ws1")).projects[0]?.title).toBe("Q3");
    await expect(listProjects("ws1")).resolves.toEqual({ projects: [], total: 0 });
    expect((await searchProjects("ws1", { q: "Q" })).total).toBe(1);
    await expect(searchProjects("ws1")).resolves.toEqual({ projects: [], total: 0 });
  });

  it("createProject returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ project: { nope: true } }));
    await expect(createProject("ws1", { title: "Q3" })).resolves.toBeNull();
  });

  it("listProjectResources degrades on malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ resources: [{ id: 1 }] }));
    await expect(listProjectResources("ws1", "p1")).resolves.toEqual({
      resources: [],
      total: 0,
    });
  });
});
