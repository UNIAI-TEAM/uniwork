import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { createTask, deleteTask, listComments, listTasks, getTask, updateTask } from "./tasks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validTask = {
  id: "t1", workspace_id: "ws1", title: "Việc", description: "",
  status: "todo", priority: "medium", position: 1024, created_by: "u1",
  created_at: "2026-08-25T00:00:00Z", updated_at: "2026-08-25T00:00:00Z",
};

/**
 * Every endpoint gets the same three checks: a well-formed response comes
 * back typed, a malformed one comes back as the fallback WITHOUT throwing,
 * and a value this client predates (a new enum member) still parses. This is
 * the contract that keeps an API drift a degraded page instead of a white one.
 */
describe("tasks endpoints", () => {
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

  it("listTasks returns the tasks", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ tasks: [validTask] }));
    expect(await listTasks("ws1")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws1/tasks");
  });

  it("listTasks returns [] instead of throwing on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ tasks: [{ id: 1 }] }));
    await expect(listTasks("ws1")).resolves.toEqual([]);
  });

  it("listTasks lets an unknown status through", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ tasks: [{ ...validTask, status: "archived" }] }));
    const [task] = await listTasks("ws1");
    expect(task?.status).toBe("archived");
  });

  it("getTask returns null on drift so the caller can render not-found", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: { nope: true } }));
    await expect(getTask("t1")).resolves.toBeNull();
  });

  it("createTask / updateTask post the body and return the task", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ task: validTask }))
      .mockResolvedValueOnce(json({ task: { ...validTask, title: "Sửa" } }));
    const created = await createTask("ws1", { title: "Việc" });
    expect(created?.id).toBe("t1");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Việc" });
    const updated = await updateTask("t1", { title: "Sửa" });
    expect(updated?.title).toBe("Sửa");
  });

  it("deleteTask resolves with no body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await expect(deleteTask("t1")).resolves.toBeUndefined();
  });

  it("listComments returns [] on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ comments: "nope" }));
    await expect(listComments("t1")).resolves.toEqual([]);
  });
});
