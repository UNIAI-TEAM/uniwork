// GET .../chat/sync: the path it asks, what it reads, and that an answer that does not parse is no answer.
import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>() }));
vi.mock("../api", () => ({ api: transport }));

import { chatSyncApi, createChatSyncApi } from "./api";

const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
const sync = createChatSyncApi(request);
const msg = { id: "m1", room_id: "r1", workspace_id: "w1", sender_id: "u1", sender_display_name: "A", body: "hi", created_at: "2026-10-17T00:00:00Z" };

beforeEach(() => {
  request.mockReset();
  transport.request.mockReset();
});

describe("chat sync api", () => {
  it("asks for the changes after a head, or only for the head", async () => {
    request.mockResolvedValueOnce({ head: 7, reset: false, changes: [{ seq: 7, room_id: "r1", message_id: "m1", kind: "updated", message: msg }] });
    const page = await sync.sync("w 1", 5);
    expect(request).toHaveBeenLastCalledWith("/api/v1/workspaces/w%201/chat/sync?since=5", undefined);
    expect(page?.changes[0]).toMatchObject({ seq: 7, kind: "updated", message: { id: "m1", body: "hi" } });

    const signal = new AbortController().signal;
    request.mockResolvedValueOnce({ head: 9, reset: false, changes: [{ seq: 9, room_id: "r1", message_id: "m2", kind: "deleted", message: null }] });
    expect(await sync.sync("w1", null, signal)).toEqual({ head: 9, reset: false, changes: [{ seq: 9, room_id: "r1", message_id: "m2", kind: "deleted", message: null }] });
    expect(request).toHaveBeenLastCalledWith("/api/v1/workspaces/w1/chat/sync", { signal });
  });

  // A full page says more (server pages at 200 changes); an older server that never sends it means the page is complete.
  it("reads whether more changes follow the page", async () => {
    request.mockResolvedValueOnce({ head: 210, reset: false, more: true, changes: [] });
    expect((await sync.sync("w1", 10))?.more).toBe(true);
    request.mockResolvedValueOnce({ head: 210, reset: false, changes: [] });
    expect((await sync.sync("w1", 10))?.more).toBeUndefined();
  });

  it("degrades a malformed answer to no answer instead of throwing", async () => {
    for (const bad of [{ head: 7, reset: false, more: "yes", changes: [] }, { head: "7", reset: false, changes: [] }, { head: 7, reset: false, changes: [{ seq: 7, room_id: "", message_id: "m" }] }, "<html>", null]) {
      request.mockResolvedValueOnce(bad);
      expect(await sync.sync("w1", 1)).toBeNull();
    }
  });

  it("the app's binding goes through the app's transport", async () => {
    transport.request.mockResolvedValueOnce({ head: 0, reset: false, changes: [] });
    expect(await chatSyncApi.sync("w1", null)).toEqual({ head: 0, reset: false, changes: [] });
    expect(transport.request).toHaveBeenCalledWith("/api/v1/workspaces/w1/chat/sync", undefined);
  });
});
