import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { createMeetingSummary, createTasksFromSummary, getMeetingSummary } from "./meeting-summary";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const summary = {
  id: "s1",
  meeting_id: "m1",
  summary: "S",
  decisions: ["D"],
  action_items: [
    { index: 0, title: "Gửi biên bản", owner: "Minh", due: "thứ Sáu", suggested_assignee_id: "u1", due_date: "2026-09-05" },
    { index: 1, title: "Báo khách", task_id: "t9" },
  ],
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

  it("getMeetingSummary reads the suggestions and the items already converted", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary }));
    const got = await getMeetingSummary("m1");
    expect(got?.action_items).toEqual([
      expect.objectContaining({ index: 0, suggested_assignee_id: "u1", due_date: "2026-09-05" }),
      expect.objectContaining({ index: 1, task_id: "t9" }),
    ]);
  });

  it("getMeetingSummary answers null for no summary, an old server's 404, and a summary that does not parse", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: null }));
    expect(await getMeetingSummary("m1")).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "not_found", message: "not found" } }, 404));
    expect(await getMeetingSummary("m1")).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { id: "x" } }));
    expect(await getMeetingSummary("m1")).toBeNull();
  });

  it("getMeetingSummary drops one malformed action item, not the whole summary", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        summary: {
          ...summary,
          decisions: ["D", 7],
          action_items: [{ title: 42 }, { title: "Còn lại", owner: null, due: null, task_id: null }],
          model: null,
        },
      }),
    );
    const got = await getMeetingSummary("m1");
    expect(got?.summary).toBe("S");
    expect(got?.decisions).toEqual(["D"]);
    // The kept entry had no index, so it keeps its position.
    expect(got?.action_items).toEqual([expect.objectContaining({ index: 1, title: "Còn lại" })]);
  });

  it("createMeetingSummary sends the locale and degrades to null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary }));
    expect((await createMeetingSummary("m1", "vi"))?.summary).toBe("S");
    expect(sentBody()).toEqual({ locale: "vi" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { summary: 1 } }));
    expect(await createMeetingSummary("m1", "en")).toBeNull();
  });

  it("createTasksFromSummary sends the body as given and returns the links", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task_ids: ["t1"], items: [{ index: 0, task_id: "t1" }] }));
    const body = { summary_id: "s1", items: [{ index: 0, assignee_id: null, due_date: null, project_id: "" }] };
    expect(await createTasksFromSummary("m1", body)).toEqual({ task_ids: ["t1"], items: [{ index: 0, task_id: "t1" }] });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/meetings/m1/summary/tasks");
    expect(sentBody()).toEqual(body);
  });

  it("createTasksFromSummary answers null for a response it cannot read, never zero tasks", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ task_ids: "nope" }));
    expect(await createTasksFromSummary("m1", { summary_id: "s1", items: [] })).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ task_ids: ["t1"] }));
    expect(await createTasksFromSummary("m1", { summary_id: "s1", items: [] })).toEqual({ task_ids: ["t1"], items: [] });
  });
});
