import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { createMeetingCatchUp, createMeetingSummary, getMeetingSummary } from "./meeting-summary";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const summary = {
  id: "s1",
  meeting_id: "m1",
  summary: "S",
  decisions: ["D"],
  model: "claude-sonnet",
  created_by: "u-host",
  created_at: "2026-09-04T03:00:00Z",
};

function sentBody(): unknown {
  const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("meeting summary endpoints", () => {
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

  it("getMeetingSummary answers null for no summary, an old server's 404, and a summary that does not parse", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: null }));
    expect(await getMeetingSummary("m1")).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "not_found", message: "not found" } }, 404));
    expect(await getMeetingSummary("m1")).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { id: "x" } }));
    expect(await getMeetingSummary("m1")).toBeNull();
  });

  it("getMeetingSummary drops one malformed decision, not the whole summary", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { ...summary, decisions: ["D", 7], model: null } }));
    const got = await getMeetingSummary("m1");
    expect(got?.summary).toBe("S");
    expect(got?.decisions).toEqual([{ text: "D", evidence: [] }]);
  });

  it("getMeetingSummary reads decisions with evidence and keeps the well-formed references", async () => {
    const decisions = [
      { text: "Chốt A", evidence: [{ kind: "segment", id: "g1" }, { kind: 3 }, "x"] },
      { text: "Chốt B" },
      { text: "Chốt C", evidence: "nope" },
      { evidence: [] },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { ...summary, decisions } }));
    expect((await getMeetingSummary("m1"))?.decisions).toEqual([
      { text: "Chốt A", evidence: [{ kind: "segment", id: "g1" }] },
      { text: "Chốt B", evidence: [] },
      { text: "Chốt C", evidence: [] },
    ]);
  });

  it("createMeetingSummary sends the locale and degrades to null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary }));
    expect((await createMeetingSummary("m1", "vi"))?.summary).toBe("S");
    expect(sentBody()).toEqual({ locale: "vi" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { summary: 1 } }));
    expect(await createMeetingSummary("m1", "en")).toBeNull();
  });

  it("createMeetingCatchUp posts the locale and keeps each point's time", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        summary: "Đã chốt lịch demo.",
        highlights: [{ text: "Demo thứ Sáu", segment_id: "g1", spoken_at: "2026-10-21T02:05:00Z" }, { text: "Từ ghi chú" }],
        action_items: [{ title: "Gửi bản demo", owner: "An", segment_id: "g2", spoken_at: "2026-10-21T02:10:00Z" }],
        generated_at: "2026-10-21T02:25:00Z",
        partial: false,
      }),
    );
    const res = await createMeetingCatchUp("m1", "vi");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/meetings/m1/catch-up");
    expect(sentBody()).toEqual({ locale: "vi" });
    expect(res?.highlights[0]).toEqual({ text: "Demo thứ Sáu", segment_id: "g1", spoken_at: "2026-10-21T02:05:00Z" });
    expect(res?.action_items[0]?.title).toBe("Gửi bản demo");
  });

  it("createMeetingCatchUp degrades: bad lists read as empty, no summary reads as null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: "S", highlights: "x", action_items: null, partial: "no" }));
    expect(await createMeetingCatchUp("m1", "vi")).toEqual({
      summary: "S",
      highlights: [],
      action_items: [],
      generated_at: "",
      partial: false,
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: 3 }));
    expect(await createMeetingCatchUp("m1", "en")).toBeNull();
  });
});
