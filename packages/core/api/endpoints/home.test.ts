import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { getHomePreference, getHomeSummary, putHomePreference } from "./home";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const task = {
  id: "t1", workspace_id: "ws1", title: "Viết spec", description: "", status: "todo", priority: "high",
  position: 1, created_by: "u1", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
  due_date: "2026-09-10", identifier: "ALP-1",
};
const meeting = {
  id: "m1", workspace_id: "ws1", title: "Standup", description: "", starts_at: "2026-09-14T02:00:00Z",
  ends_at: "2026-09-14T02:30:00Z", room_name: "r", created_by: "u1", status: "SCHEDULED",
};
const notification = {
  id: "n1", kind: "task_assigned", workspace_id: "ws1", resource_type: "task", resource_id: "t1",
  title_key: "notifications.kind.task_assigned", params: { actor: "An", task: "Viết spec" }, created_at: "2026-09-14T01:00:00Z",
};
const summary = {
  today: "2026-09-14", timezone: "Asia/Ho_Chi_Minh",
  counts: { open: 3, overdue: 1, due_today: 1, meetings_today: 1, unread: 2 },
  my_work: [task], upcoming_meetings: [meeting], inbox: [notification], partial: [], generated_at: "2026-09-14T03:00:00Z",
};

describe("home endpoints", () => {
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

  it("getHomeSummary reads every section of the workspace home", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(summary));
    const got = await getHomeSummary("ws 1");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/workspaces/ws%201/home");
    expect(got?.counts).toEqual(summary.counts);
    expect(got?.my_work[0]!.identifier).toBe("ALP-1");
    expect(got?.upcoming_meetings[0]!.title).toBe("Standup");
    expect(got?.inbox[0]!.kind).toBe("task_assigned");
    expect(got?.partial).toEqual([]);
  });

  it("getHomeSummary empties a drifted section and reports it as partial, keeping the rest", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ ...summary, my_work: [{ id: 7 }], counts: { ...summary.counts, unread: "many" }, partial: ["meetings"] }),
    );
    const got = await getHomeSummary("ws1");
    expect(got?.my_work).toEqual([]);
    expect(got?.upcoming_meetings).toHaveLength(1);
    expect(got?.counts.unread).toBe(0);
    expect(got?.counts.open).toBe(3);
    expect(got?.partial).toEqual(["meetings", "tasks"]);
  });

  it("getHomeSummary degrades to null when the response is unusable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ counts: summary.counts }));
    await expect(getHomeSummary("ws1")).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json("oops"));
    await expect(getHomeSummary("ws1")).resolves.toBeNull();
  });

  it("getHomePreference returns the saved layout and an empty one when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ prefs: { layout: "compact" }, updated_at: "2026-09-14T03:00:00Z" }));
    expect(await getHomePreference("ws1")).toEqual({ prefs: { layout: "compact" }, updated_at: "2026-09-14T03:00:00Z" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ prefs: ["x"] }));
    expect(await getHomePreference("ws1")).toEqual({ prefs: {}, updated_at: "" });
  });

  it("putHomePreference sends the layout under prefs and survives a malformed answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ prefs: { layout: "wide" }, updated_at: "t" }));
    const saved = await putHomePreference("ws1", { layout: "wide" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/workspaces/ws1/home/preferences");
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ prefs: { layout: "wide" } });
    expect(saved).toEqual({ prefs: { layout: "wide" }, updated_at: "t" });
    vi.mocked(fetch).mockResolvedValueOnce(json("oops"));
    await expect(putHomePreference("ws1", {})).resolves.toBeNull();
  });
});
