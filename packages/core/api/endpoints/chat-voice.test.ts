import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { mintChatVoiceToken, signalChatVoiceHangup } from "./chat-voice";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("chat-voice endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("mintChatVoiceToken returns the token and trims ids", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ token: "tok", url: "wss://live.test" }));
    const result = await mintChatVoiceToken("  room1 ", " call1 ");
    expect(result).toEqual({ token: "tok", url: "wss://live.test" });
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ room_id: "room1", call_id: "call1" });
  });

  it("mintChatVoiceToken returns null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(mintChatVoiceToken("room1", "call1")).resolves.toBeNull();
  });

  it("signalChatVoiceHangup sends duration_seconds when positive", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await expect(signalChatVoiceHangup("ws1", "room1", "call1", 30)).resolves.toBe(true);
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ call_id: "call1", duration_seconds: 30 });
  });

  it("signalChatVoiceHangup omits duration_seconds when absent or not positive", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(json({ status: "ok" }));
    await signalChatVoiceHangup("ws1", "room1", "call1");
    await signalChatVoiceHangup("ws1", "room1", "call1", 0);
    const [, first] = vi.mocked(fetch).mock.calls[0] ?? [];
    const [, second] = vi.mocked(fetch).mock.calls[1] ?? [];
    expect(JSON.parse(String(first?.body))).toEqual({ call_id: "call1" });
    expect(JSON.parse(String(second?.body))).toEqual({ call_id: "call1" });
  });

  it("listChatVoiceRecordings returns rows or empty on drift", async () => {
    const { listChatVoiceRecordings } = await import("./chat-voice");
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        recordings: [
          {
            id: "rec1",
            status: "COMPLETE",
            started_at: "2026-09-15T10:00:00Z",
            started_by: "user1",
          },
        ],
      }),
    );
    await expect(listChatVoiceRecordings("ws1", "room1")).resolves.toEqual([
      {
        id: "rec1",
        call_id: "",
        status: "COMPLETE",
        file_url: "",
        started_by: "user1",
        started_at: "2026-09-15T10:00:00Z",
        ended_at: "",
      },
    ]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(listChatVoiceRecordings("ws1", "room1")).resolves.toEqual([]);
  });

  it("getChatVoiceRecordingPlaybackUrl returns presigned url or null on drift", async () => {
    const { getChatVoiceRecordingPlaybackUrl } = await import("./chat-voice");
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        playback_url: "https://s3.test/rec.mp4?sig=1",
        expires_at: "2026-09-15T11:00:00Z",
      }),
    );
    await expect(getChatVoiceRecordingPlaybackUrl("ws1", "room1", "rec1")).resolves.toEqual({
      playback_url: "https://s3.test/rec.mp4?sig=1",
      expires_at: "2026-09-15T11:00:00Z",
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(getChatVoiceRecordingPlaybackUrl("ws1", "room1", "rec1")).resolves.toBeNull();
  });

  it("startChatVoiceRecording returns recording or null on drift", async () => {
    const { startChatVoiceRecording, stopChatVoiceRecording } = await import("./chat-voice");
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ recording: { id: "rec1", status: "ACTIVE", file_url: "" } }),
    );
    await expect(startChatVoiceRecording("ws1", "room1", "call1")).resolves.toEqual({
      id: "rec1",
      status: "ACTIVE",
      file_url: "",
      started_by: "",
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(stopChatVoiceRecording("ws1", "room1", "call1")).resolves.toBeNull();
  });
});
