import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ensureWorkspaceChatRoom, getWorkspaceChatRoom, lookupChatUser } from "./chat";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("chat endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("getWorkspaceChatRoom degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await getWorkspaceChatRoom("ws1")).toBeNull();
  });

  it("getWorkspaceChatRoom returns null when room_id is absent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ workspace_id: "ws1", enabled: true }),
    );
    expect(await getWorkspaceChatRoom("ws1")).toBeNull();
  });

  it("getWorkspaceChatRoom returns null when matrix is disabled on server", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ workspace_id: "ws1", enabled: false }),
    );
    expect(await getWorkspaceChatRoom("ws1")).toBeNull();
  });

  it("ensureWorkspaceChatRoom returns room on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ room_id: "!abc:localhost", workspace_id: "ws1" }),
    );
    const room = await ensureWorkspaceChatRoom("ws1", "syt_tok");
    expect(room?.room_id).toBe("!abc:localhost");
  });

  it("lookupChatUser degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await lookupChatUser("a@b.com")).toBeNull();
  });
});
