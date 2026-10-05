import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { beatChatPresence } from "./chat-presence";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("beatChatPresence", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("posts an online beat and returns the online ids", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok", online_user_ids: ["U1", "U2"] }));
    await expect(beatChatPresence("ws 1")).resolves.toEqual(["U1", "U2"]);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/ws%201/chat/presence");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ state: "online" });
  });

  it("returns an empty list when nobody else is online", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok", online_user_ids: [] }));
    await expect(beatChatPresence("ws1")).resolves.toEqual([]);
  });

  it("returns null from a server that answers without the list", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await expect(beatChatPresence("ws1")).resolves.toBeNull();
  });

  it("degrades to null on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok", online_user_ids: [1, null] }));
    await expect(beatChatPresence("ws1")).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json("nope"));
    await expect(beatChatPresence("ws1")).resolves.toBeNull();
  });
});
