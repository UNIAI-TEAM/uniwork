import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import {
  listChatThreadMessages,
  listFollowedChatThreads,
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

  it("sendChatThreadMessage degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: 1 }));
    await expect(
      sendChatThreadMessage("w1", "r1", "m1", { body: "hi" }),
    ).resolves.toBeNull();
  });

  it("listFollowedChatThreads degrades on malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ threads: null }));
    await expect(listFollowedChatThreads("w1")).resolves.toEqual([]);
  });
});
