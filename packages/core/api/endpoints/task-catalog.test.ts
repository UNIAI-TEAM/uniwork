import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  createTaskLabel,
  listTaskLabels,
  listTaskProperties,
  listTaskStatuses,
} from "./task-catalog";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const status = {
  id: "s1",
  organization_id: "o1",
  workspace_id: "ws1",
  key: "todo",
  name: "Todo",
  description: "",
  category: "todo",
  color: "#6b7280",
  is_system: true,
  position: 0,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
};

const label = {
  id: "l1",
  organization_id: "o1",
  workspace_id: "ws1",
  name: "Bug",
  description: "",
  color: "#ef4444",
  usage_count: 0,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
};

describe("task-catalog endpoints", () => {
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

  it("listTaskStatuses returns list and empty on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ statuses: [status], categories: ["todo"], total: 1 }),
    );
    expect((await listTaskStatuses("ws1")).statuses[0]?.key).toBe("todo");
    vi.mocked(fetch).mockResolvedValueOnce(json({ statuses: [{ id: 1 }] }));
    await expect(listTaskStatuses("ws1")).resolves.toEqual({
      statuses: [],
      categories: [],
      total: 0,
    });
  });

  it("createTaskLabel returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ label }));
    expect((await createTaskLabel("ws1", { name: "Bug" }))?.id).toBe("l1");
    vi.mocked(fetch).mockResolvedValueOnce(json({ label: { nope: true } }));
    await expect(createTaskLabel("ws1", { name: "Bug" })).resolves.toBeNull();
  });

  it("listTaskLabels / listTaskProperties degrade on malformed", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ labels: "x" }))
      .mockResolvedValueOnce(json({ properties: "x" }));
    await expect(listTaskLabels("ws1")).resolves.toEqual({ labels: [], total: 0 });
    await expect(listTaskProperties("ws1")).resolves.toEqual({ properties: [], total: 0 });
  });
});
