import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import {
  createChatMessageLink,
  createTaskFromChatMessage,
  deleteChatMessageLink,
  listChatMessageLinks,
  listChatRoomLinkedTasks,
  listChatRoomMessageLinks,
  syncChatThreadTask,
  unsyncChatThreadTask,
} from "./chat-links";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("chat link endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("createTaskFromChatMessage degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task: 1 }));
    await expect(createTaskFromChatMessage("w1", "m1", { title: "Hi" })).resolves.toBeNull();
  });

  it("listChatMessageLinks degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ links: "nope" }));
    await expect(listChatMessageLinks("w1", "m1")).resolves.toEqual([]);
  });

  it("listChatRoomMessageLinks degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ links: [{ id: 1 }] }));
    await expect(listChatRoomMessageLinks("w1", "r1", ["m1", "m2"])).resolves.toEqual([]);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
      "/chat/rooms/r1/message-links?message_ids=m1%2Cm2",
    );
  });

  it("listChatRoomMessageLinks skips the request when there is nothing to ask", async () => {
    await expect(listChatRoomMessageLinks("w1", "r1", [])).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("listChatRoomLinkedTasks degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ tasks: [{ id: 1 }], total: "seven" }));
    await expect(listChatRoomLinkedTasks("w1", "r1", 3)).resolves.toEqual({ tasks: [], total: 0 });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("/chat/rooms/r1/linked-tasks?limit=3");
  });

  it("listChatRoomLinkedTasks keeps a task whose optional fields drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ tasks: [{ id: "t1", title: "Chốt icon", status: 5, due_date: null }], total: 7 }),
    );
    const out = await listChatRoomLinkedTasks("w1", "r1");
    expect(out.total).toBe(7);
    expect(out.tasks[0]).toMatchObject({ id: "t1", title: "Chốt icon", status: "", due_date: undefined });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toMatch(/linked-tasks$/);
  });

  it("createChatMessageLink degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ link: null }));
    await expect(
      createChatMessageLink("w1", "m1", { target_type: "task", target_id: "t1" }),
    ).resolves.toBeNull();
  });

  it("deleteChatMessageLink degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({}));
    await expect(deleteChatMessageLink("w1", "m1", "l1")).resolves.toBe(false);
  });

  it("syncChatThreadTask degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "nope" }));
    await expect(syncChatThreadTask("w1", "m1", { task_id: "t1" })).resolves.toBe(false);
  });

  it("unsyncChatThreadTask degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ok: false }));
    await expect(unsyncChatThreadTask("w1", "m1")).resolves.toBe(false);
  });
});
