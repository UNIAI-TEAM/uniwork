import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  batchDeleteTasks,
  batchUpdateTasks,
  listMyTasks,
  putTask,
  queryTasks,
  setTaskDependency,
} from "./tasks-suite";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validTask = {
  id: "t1",
  organization_id: "o1",
  workspace_id: "ws1",
  number: 1,
  identifier: "ALP-1",
  revision: 2,
  title: "Việc",
  description: "",
  status: "todo",
  priority: "medium",
  position: 1024,
  created_by: "u1",
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
};

describe("tasks-suite endpoints", () => {
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

  it("queryTasks returns a page and [] tasks on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ tasks: [validTask], total: 1, limit: 50, offset: 0 }),
    );
    const page = await queryTasks("ws1", { status: "todo", project_id: "proj1", limit: 50 });
    expect(page.tasks[0]?.identifier).toBe("ALP-1");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      "http://api.test/api/v1/workspaces/ws1/tasks/query",
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body))).toMatchObject({
      status: "todo",
      project_id: "proj1",
      limit: 50,
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ tasks: [{ id: 1 }] }));
    await expect(queryTasks("ws1")).resolves.toEqual({
      tasks: [],
      total: 0,
      limit: 0,
      offset: 0,
    });
  });

  it("listMyTasks degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ tasks: "nope" }));
    await expect(listMyTasks("ws1", { relation: "assigned", limit: 10 })).resolves.toEqual({
      tasks: [],
      total: 0,
      limit: 0,
      offset: 0,
    });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      "http://api.test/api/v1/workspaces/ws1/my-tasks?relation=assigned&limit=10",
    );
  });

  it("putTask sends revision headers and returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: validTask }));
    const task = await putTask("t1", { revision: 2, title: "Sửa" }, { ifMatch: "2" });
    expect(task?.revision).toBe(2);
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe("2");
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: { nope: true } }));
    await expect(putTask("t1", { revision: 1 })).resolves.toBeNull();
  });

  it("batchUpdateTasks / batchDeleteTasks return counts and 0 on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ updated: 3 }))
      .mockResolvedValueOnce(json({ deleted: 2 }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({}));
    expect(await batchUpdateTasks("ws1", { task_ids: ["t1"], updates: { status: "done" } })).toBe(3);
    expect(await batchDeleteTasks("ws1", ["t1"])).toBe(2);
    expect(await batchUpdateTasks("ws1", { task_ids: ["t1"], updates: {} })).toBe(0);
    expect(await batchDeleteTasks("ws1", ["t1"])).toBe(0);
  });

  it("setTaskDependency returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ dependency: { id: 1 } }));
    await expect(
      setTaskDependency("t1", { depends_on_task_id: "t2", type: "blocked_by" }),
    ).resolves.toBeNull();
  });
});
