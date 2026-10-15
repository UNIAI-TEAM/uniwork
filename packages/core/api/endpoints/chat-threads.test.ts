import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import {
  listChatThreadMessages,
  listFollowedChatThreads,
  markChatThreadRead,
  sendChatThreadMessage,
} from "./chat-threads";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("chat thread endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("listChatThreadMessages degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: "nope" }));
    await expect(listChatThreadMessages("w1", "r1", "m1")).resolves.toEqual([]);
  });

  it("listChatThreadMessages reads a drifted thread_following as not following", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        messages: [
          {
            id: "m1",
            room_id: "r1",
            workspace_id: "w1",
            sender_id: "u1",
            sender_display_name: "An",
            body: "root",
            created_at: "2026-01-01T00:00:00Z",
            thread_following: "yes",
          },
        ],
      }),
    );
    const [root] = await listChatThreadMessages("w1", "r1", "m1");
    expect(root?.id).toBe("m1");
    // Absent and drifted both read as "not following"; the thread bar offers Follow.
    expect(root?.thread_following).toBeUndefined();
  });

  it("listChatThreadMessages sends the cursor verbatim", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: [] }));
    await listChatThreadMessages("w1", "r1", "m1", { cursor: "1774519200123456.01J8X", limit: 50 });
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v1/workspaces/w1/chat/rooms/r1/threads/m1/messages");
    expect(url.searchParams.get("cursor")).toBe("1774519200123456.01J8X");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("sendChatThreadMessage degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: 1 }));
    await expect(
      sendChatThreadMessage("w1", "r1", "m1", { body: "hi" }),
    ).resolves.toBeNull();
  });

  it("markChatThreadRead returns the pointer it replaced", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ok: true, previous_read_at: "2026-09-05T00:00:00.123456Z" }));
    await expect(markChatThreadRead("w1", "m1")).resolves.toBe("2026-09-05T00:00:00.123456Z");
  });

  it("markChatThreadRead degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ok: "yes", previous_read_at: 42 }));
    await expect(markChatThreadRead("w1", "m1")).resolves.toBeNull();
  });

  it("listFollowedChatThreads degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ threads: null }));
    await expect(listFollowedChatThreads("w1")).resolves.toEqual([]);
  });
});
