import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  deleteMeetingTranscription,
  deleteTranscript,
  deleteTranscriptSegment,
  editTranscriptSegment,
} from "./meeting-transcript-edit";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const seg = { id: "s1", meeting_id: "m1", text: "anh Hùng", spoken_at: "2026-10-21T02:00:00Z", edited_at: "2026-10-21T05:00:00Z" };
const call = (i: number) => vi.mocked(fetch).mock.calls[i]!;

describe("transcript edit endpoints (UNI-1995 #5)", () => {
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

  it("PATCHes a line and reads it back", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ segment: seg }));
    expect(await editTranscriptSegment("m1", "s1", "anh Hùng")).toEqual(seg);
    const [url, init] = call(0);
    expect(String(url)).toBe("http://api.test/api/v1/meetings/m1/transcript/s1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "anh Hùng" });
  });

  it("deletes a line, a stretch, all lines and a transcription", async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ deleted: 3, status: "ok" }));
    await deleteTranscriptSegment("m1", "s1");
    expect(await deleteTranscript("m1", { fromSegmentId: "s1", toSegmentId: "s9" })).toBe(3);
    expect(await deleteTranscript("m1")).toBe(3);
    await deleteMeetingTranscription("m1", "t1");
    expect(call(0)[1]?.method).toBe("DELETE");
    expect(String(call(0)[0])).toBe("http://api.test/api/v1/meetings/m1/transcript/s1");
    expect(String(call(1)[0])).toBe(
      "http://api.test/api/v1/meetings/m1/transcript?from_segment_id=s1&to_segment_id=s9",
    );
    expect(String(call(2)[0])).toBe("http://api.test/api/v1/meetings/m1/transcript");
    expect(String(call(3)[0])).toBe("http://api.test/api/v1/meetings/m1/transcriptions/t1");
  });

  it.each([{ nope: true }, { segment: { id: 1 } }, null, [], "str"])("degrades on a malformed answer %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(editTranscriptSegment("m1", "s1", "x")).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(deleteTranscript("m1")).resolves.toBeNull();
  });
});
