import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { transcribeChatVoiceMessage } from "./chat-voice-transcript";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("transcribeChatVoiceMessage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("posts to the message and returns the transcript", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ text: "Xin chào", language: "vietnamese" }));
    await expect(transcribeChatVoiceMessage("w1", "m1")).resolves.toEqual({ text: "Xin chào", language: "vietnamese" });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/chat/messages/m1/transcript");
    expect(init?.method).toBe("POST");
  });

  it("degrades on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ text: 5 }));
    await expect(transcribeChatVoiceMessage("w1", "m1")).resolves.toEqual({ text: "", language: "" });
    vi.mocked(fetch).mockResolvedValueOnce(json("nope"));
    await expect(transcribeChatVoiceMessage("w1", "m1")).resolves.toEqual({ text: "", language: "" });
  });

  it("carries the refusal code", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "cloud_unavailable", message: "x" } }, 503));
    await expect(transcribeChatVoiceMessage("w1", "m1")).rejects.toMatchObject({ code: "cloud_unavailable", status: 503 });
  });
});
