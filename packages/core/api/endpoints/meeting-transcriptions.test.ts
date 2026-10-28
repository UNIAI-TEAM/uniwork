import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { listMeetingTranscriptions, recordMeetingHeld, requestMeetingTranscription } from "./meeting-transcriptions";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const transcription = {
  id: "t1",
  meeting_id: "m1",
  file_id: "f1",
  filename: "hop.m4a",
  size_bytes: 2_880_000,
  language: "vi",
  status: "RUNNING",
  attempts: 1,
  starts_at: "2026-10-20T01:30:00Z",
  estimated_seconds: 2538,
  created_by: "u1",
  created_at: "2026-10-20T04:00:00Z",
};
const malformed = [null, [], "nope", { transcription: { id: 3 } }, { transcriptions: "x" }, { meeting: { id: 1 } }];
// A length that is not a number: that row loses its length rather than drawing "NaN phút", and the list survives.
const badLength = { transcriptions: [{ ...transcription, estimated_seconds: "2538" }, { ...transcription, id: "t0" }] };

describe("meeting transcription endpoints", () => {
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

  it("recordMeetingHeld posts the times and returns the ended meeting", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        meeting: {
          id: "m1", workspace_id: "w1", title: "Họp", description: "", starts_at: "2026-10-21T01:00:00Z",
          ends_at: "2026-10-21T02:00:00Z", room_name: "r", created_by: "u1", status: "ENDED",
        },
      }),
    );
    const m = await recordMeetingHeld("m1", { started_at: "2026-10-20T01:30:00Z", ended_at: "2026-10-20T03:00:00Z" });
    expect(m?.status).toBe("ENDED");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/meetings/m1/held");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(String(init!.body))).toEqual({ started_at: "2026-10-20T01:30:00Z", ended_at: "2026-10-20T03:00:00Z" });
  });

  it("requestMeetingTranscription posts upload, language and consent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ transcription }, 201));
    const t = await requestMeetingTranscription("m1", { upload_id: "f1", language: "vi", consent: true });
    expect(t?.status).toBe("RUNNING");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/meetings/m1/transcriptions");
    expect(JSON.parse(String(init!.body))).toEqual({ upload_id: "f1", language: "vi", consent: true });
  });

  it("recordMeetingHeld sends duration_seconds and ended_seconds_ago", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ meeting: { id: 1 } }));
    await expect(recordMeetingHeld("m1", { duration_seconds: 3600, ended_seconds_ago: 7200 })).resolves.toBeNull();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual({ duration_seconds: 3600, ended_seconds_ago: 7200 });
  });

  it("requestMeetingTranscription sends offset_seconds", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ transcription }, 201)).mockResolvedValueOnce(json({ transcription: { id: 3 } }));
    const body = { upload_id: "f1", language: "vi", consent: true, duration_seconds: 300, offset_seconds: 0 };
    expect((await requestMeetingTranscription("m1", body))?.id).toBe("t1");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual(body);
    await expect(requestMeetingTranscription("m1", { ...body, offset_seconds: 300 })).resolves.toBeNull();
  });

  it("listMeetingTranscriptions reads the list", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ transcriptions: [transcription, { ...transcription, id: "t0", status: "FAILED", error_code: "timeout" }] }));
    const list = await listMeetingTranscriptions("m1");
    expect(list.map((t) => t.id)).toEqual(["t1", "t0"]);
    expect(list[1]?.error_code).toBe("timeout");
    expect(list[0]?.estimated_seconds).toBe(2538);
  });

  it("degrades malformed responses instead of throwing", async () => {
    for (const bad of malformed) {
      vi.mocked(fetch).mockResolvedValueOnce(json(bad));
      await expect(recordMeetingHeld("m1", { started_at: "a", ended_at: "b" })).resolves.toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(bad));
      await expect(requestMeetingTranscription("m1", { upload_id: "f", language: "vi", consent: true })).resolves.toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(bad));
      await expect(listMeetingTranscriptions("m1")).resolves.toEqual([]);
    }
    vi.mocked(fetch).mockResolvedValueOnce(json(badLength));
    const list = await listMeetingTranscriptions("m1");
    expect(list.map((t) => t.id)).toEqual(["t1", "t0"]);
    expect(list[0]?.estimated_seconds).toBeUndefined();
    expect(list[1]?.estimated_seconds).toBe(2538);
  });
});
