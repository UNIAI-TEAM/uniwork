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
    expect((await getMeetingSummary("m1")).summary).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "not_found", message: "not found" } }, 404));
    expect(await getMeetingSummary("m1")).toEqual({ summary: null, run: { status: "idle", at: null, attempts: 0 } });
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { id: "x" } }));
    expect((await getMeetingSummary("m1")).summary).toBeNull();
  });

  it("getMeetingSummary reads the run, and a malformed or unknown run reads idle", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: null, run: { status: "running", at: "2026-10-23T02:00:00Z", attempts: 2 } }));
    expect((await getMeetingSummary("m1")).run).toEqual({ status: "running", at: "2026-10-23T02:00:00Z", attempts: 2 });
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary, run: { status: "exploding", at: 5, attempts: "x" } }));
    const drifted = await getMeetingSummary("m1");
    expect(drifted.summary?.summary).toBe("S");
    expect(drifted.run).toEqual({ status: "idle", at: null, attempts: 0 });
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary, run: "nope" }));
    expect((await getMeetingSummary("m1")).run.status).toBe("idle");
  });

  it("getMeetingSummary reads @7 topics and open questions, dropping a malformed topic", async () => {
    const topics = [
      { title: "Ngân sách", start: { kind: "segment", id: "g1" }, start_at: "2026-10-23T02:05:00Z", points: [{ text: "2 tỷ", evidence: [{ kind: "segment", id: "g2" }] }, 9] },
      { title: "Tuyển dụng", start: "bad", start_at: 3, points: "x" },
      { start: null },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { ...summary, topics, open_questions: [{ text: "Ai duyệt?" }, 1] } }));
    const got = (await getMeetingSummary("m1")).summary;
    expect(got?.topics).toEqual([
      { title: "Ngân sách", start: { kind: "segment", id: "g1" }, start_at: "2026-10-23T02:05:00Z", points: [{ text: "2 tỷ", evidence: [{ kind: "segment", id: "g2" }] }] },
      { title: "Tuyển dụng", start: null, start_at: null, points: [] },
    ]);
    expect(got?.open_questions).toEqual([{ text: "Ai duyệt?", evidence: [] }]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { ...summary, topics: "x", open_questions: {} } }));
    const drifted = (await getMeetingSummary("m1")).summary;
    expect(drifted?.summary).toBe("S");
    expect(drifted?.topics).toEqual([]);
    expect(drifted?.open_questions).toEqual([]);
  });

  it("getMeetingSummary reads @8 summary points and drops a malformed one", async () => {
    const points = [{ text: "Chốt ngày 30/10.", evidence: [{ kind: "segment", id: "g1" }] }, 4, { text: "Ngân sách 350 triệu." }];
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { ...summary, summary_points: points } }));
    expect((await getMeetingSummary("m1")).summary?.summary_points).toEqual([
      { text: "Chốt ngày 30/10.", evidence: [{ kind: "segment", id: "g1" }] },
      { text: "Ngân sách 350 triệu.", evidence: [] },
    ]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { ...summary, summary_points: "x" } }));
    expect((await getMeetingSummary("m1")).summary?.summary_points).toEqual([]);
  });

  it("getMeetingSummary drops one malformed decision, not the whole summary", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { ...summary, decisions: ["D", 7], model: null } }));
    const got = (await getMeetingSummary("m1")).summary;
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
    expect((await getMeetingSummary("m1")).summary?.decisions).toEqual([
      { text: "Chốt A", evidence: [{ kind: "segment", id: "g1" }] },
      { text: "Chốt B", evidence: [] },
      { text: "Chốt C", evidence: [] },
    ]);
  });

  it("createMeetingSummary sends the locale and reads the run it started (202)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary, run: { status: "running", at: "2026-10-23T02:00:00Z", attempts: 0, failure: null } }, 202));
    const started = await createMeetingSummary("m1", "vi");
    expect(sentBody()).toEqual({ locale: "vi" });
    expect(started.summary?.summary).toBe("S");
    expect(started.run).toEqual({ status: "running", at: "2026-10-23T02:00:00Z", attempts: 0, failure: null });
  });

  it("createMeetingSummary degrades on drift: a bad summary reads null, a body it cannot read reads running", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { summary: 1 }, run: { status: "running", at: null, attempts: 0 } }, 202));
    const drifted = await createMeetingSummary("m1", "en");
    expect(drifted.summary).toBeNull();
    expect(drifted.run.status).toBe("running");
    // The server accepted the run: an unreadable answer must not read as "nothing is happening".
    vi.mocked(fetch).mockResolvedValueOnce(json("nope", 202));
    expect(await createMeetingSummary("m1", "en")).toEqual({ summary: null, run: { status: "running", at: null, attempts: 0 } });
  });

  it("getMeetingSummary reads the last run's failure, and a malformed one reads none", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: null, run: { status: "idle", at: null, attempts: 0, failure: { code: "ai_timeout", at: "2026-10-23T02:03:00Z" } } }));
    expect((await getMeetingSummary("m1")).run.failure).toEqual({ code: "ai_timeout", at: "2026-10-23T02:03:00Z" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: null, run: { status: "idle", at: null, attempts: 0, failure: { code: 7 } } }));
    const drifted = await getMeetingSummary("m1");
    expect(drifted.run.status).toBe("idle");
    expect(drifted.run.failure ?? null).toBeNull();
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
