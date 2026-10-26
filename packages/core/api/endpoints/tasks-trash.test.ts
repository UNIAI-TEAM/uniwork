import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  listProjectTrash,
  listTaskTrash,
  purgeProject,
  purgeTask,
  restoreProject,
  restoreTask,
} from "./tasks-trash";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const taskItem = {
  id: "t1",
  identifier: "UNI-1",
  title: "Việc",
  trashed_at: "2026-10-26T00:00:00Z",
  trashed_by: "u1",
  purge_after: "2026-11-25T00:00:00Z",
  batch_size: 3,
};
const projectItem = {
  id: "p1",
  title: "Dự án",
  trashed_at: "2026-10-26T00:00:00Z",
  trashed_by: "u1",
  purge_after: "2026-11-25T00:00:00Z",
  task_count: 4,
};
const emptyPage = { items: [], next_cursor: "" };

describe("trash endpoints", () => {
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

  const url = (n = 0) => String(vi.mocked(fetch).mock.calls[n]![0]);
  const method = (n = 0) => vi.mocked(fetch).mock.calls[n]![1]!.method;

  it("listTaskTrash returns the page and sends the cursor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [taskItem], next_cursor: "c2" }));
    const page = await listTaskTrash("ws1", "c1");
    expect(page.items[0]).toMatchObject({ id: "t1", batch_size: 3 });
    expect(page.next_cursor).toBe("c2");
    expect(url()).toBe("http://api.test/api/v1/workspaces/ws1/tasks/trash?cursor=c1");
  });

  it("listTaskTrash degrades to an empty page on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: "nope" }));
    await expect(listTaskTrash("ws1")).resolves.toEqual(emptyPage);
    expect(url()).toBe("http://api.test/api/v1/workspaces/ws1/tasks/trash");
  });

  it("restoreTask returns the batch and degrades on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ trash_batch_id: "b1", ids: ["t1", "t2"] }))
      .mockResolvedValueOnce(json({ ids: 7 }));
    await expect(restoreTask("t1")).resolves.toEqual({ trash_batch_id: "b1", ids: ["t1", "t2"] });
    expect(url()).toBe("http://api.test/api/v1/tasks/t1/restore");
    expect(method()).toBe("POST");
    await expect(restoreTask("t1")).resolves.toEqual({ trash_batch_id: "", ids: [] });
  });

  it("purgeTask posts and resolves with no value", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await expect(purgeTask("t1")).resolves.toBeUndefined();
    expect(url()).toBe("http://api.test/api/v1/tasks/t1/purge");
    expect(method()).toBe("POST");
  });

  it("listProjectTrash returns the page, degrades on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ items: [projectItem], next_cursor: "" }))
      .mockResolvedValueOnce(json([1]));
    expect((await listProjectTrash("ws1")).items[0]).toMatchObject({ id: "p1", task_count: 4 });
    expect(url()).toBe("http://api.test/api/v1/workspaces/ws1/projects/trash");
    await expect(listProjectTrash("ws1")).resolves.toEqual(emptyPage);
  });

  it("restoreProject / purgeProject post to the project routes", async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ status: "ok" }));
    await expect(restoreProject("ws1", "p1")).resolves.toBeUndefined();
    await expect(purgeProject("ws1", "p1")).resolves.toBeUndefined();
    expect(url(0)).toBe("http://api.test/api/v1/workspaces/ws1/projects/p1/restore");
    expect(url(1)).toBe("http://api.test/api/v1/workspaces/ws1/projects/p1/purge");
    expect(method(1)).toBe("POST");
  });

  it("restoreProject surfaces the duplicate-title conflict", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "duplicate_project_title", message: "x", error_class: "conflict" } }, 409),
    );
    await expect(restoreProject("ws1", "p1")).rejects.toMatchObject({ status: 409 });
  });
});
