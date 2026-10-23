import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  addMeetingActionItem,
  convertMeetingActionItems,
  dismissMeetingActionItem,
  getMeetingActionItems,
  getMeetingCarriedOverItems,
  linkMeetingActionItem,
  restoreMeetingActionItem,
} from "./meeting-action-items";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const pending = {
  id: "a1",
  source: "AI",
  position: 0,
  title: "Gửi biên bản",
  owner_text: "Minh",
  due_text: "thứ Sáu",
  suggested_assignee_id: "u1",
  suggested_due_date: "2026-10-30",
  status: "PENDING",
  dismiss_reason: "",
  dismissed_by: null,
  dismissed_at: null,
  task: null,
  evidence: [],
  summary_id: "s1",
  created_at: "2026-10-20T08:00:00Z",
};
const converted = {
  ...pending,
  id: "a2",
  status: "CONVERTED",
  suggested_assignee_id: null,
  task: { id: "t1", title: "Gửi biên bản", status: "todo", done: false, overdue: true, assignee_id: "u1", due_date: "2026-10-01" },
};
const counts = { pending: 1, converted: 1, dismissed: 0, tasks_done: 0, tasks_overdue: 1 };

function sent(call = 0): { url: string; method?: string; body: unknown } {
  const [url, init] = vi.mocked(fetch).mock.calls[call]! as [string, RequestInit];
  return { url: String(url), method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined };
}

describe("meeting action item endpoints", () => {
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

  it("getMeetingActionItems reads the items, their tasks and the counts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [pending, converted], counts }));
    const got = await getMeetingActionItems("m1");
    expect(sent().url).toBe("http://api.test/api/v1/meetings/m1/action-items");
    expect(got.items.map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(got.items[1]?.task).toEqual(expect.objectContaining({ id: "t1", overdue: true }));
    expect(got.counts).toEqual(counts);
  });

  it("getMeetingActionItems keeps the well-formed evidence of an item and reads a missing one as none", async () => {
    const items = [{ ...pending, evidence: [{ kind: "note", id: "n1" }, { id: 4 }] }, { ...converted, evidence: null }];
    vi.mocked(fetch).mockResolvedValueOnce(json({ items, counts }));
    const got = await getMeetingActionItems("m1");
    expect(got.items[0]?.evidence).toEqual([{ kind: "note", id: "n1" }]);
    expect(got.items[1]?.evidence).toEqual([]);
  });

  it("getMeetingActionItems reads the AI's prose and suggested priority, and a wrong type as none", async () => {
    const items = [
      { ...pending, description: "Gửi biên bản cho cả nhóm.", suggested_priority: "high" },
      { ...converted, description: 4, suggested_priority: ["x"] },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(json({ items, counts }));
    const got = await getMeetingActionItems("m1");
    expect(got.items[0]).toEqual(expect.objectContaining({ description: "Gửi biên bản cho cả nhóm.", suggested_priority: "high" }));
    // A drifted field costs the field, not the item.
    expect(got.items[1]).toEqual(expect.objectContaining({ id: "a2", description: null, suggested_priority: null }));
  });

  it("getMeetingActionItems drops a malformed item, zeroes bad counts, and degrades to empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [{ id: 7 }, pending], counts: { pending: "x" } }));
    const got = await getMeetingActionItems("m1");
    expect(got.items.map((i) => i.id)).toEqual(["a1"]);
    expect(got.counts).toEqual({ pending: 0, converted: 0, dismissed: 0, tasks_done: 0, tasks_overdue: 0 });
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: "nope" }));
    expect((await getMeetingActionItems("m1")).items).toEqual([]);
  });

  it("addMeetingActionItem sends the body and answers null for a response it cannot read", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ item: { ...pending, source: "MANUAL" } }));
    expect((await addMeetingActionItem("m1", { title: "Gửi biên bản" }))?.source).toBe("MANUAL");
    expect(sent()).toEqual({ url: "http://api.test/api/v1/meetings/m1/action-items", method: "POST", body: { title: "Gửi biên bản" } });
    vi.mocked(fetch).mockResolvedValueOnce(json({ item: { title: 1 } }));
    expect(await addMeetingActionItem("m1", { title: "x" })).toBeNull();
  });

  it("dismiss sends the reason only when there is one; restore names the item", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ status: "ok" })));
    await dismissMeetingActionItem("m1", "a1", "Trùng");
    await dismissMeetingActionItem("m1", "a1", "");
    await restoreMeetingActionItem("m1", "a1");
    expect(sent(0)).toEqual({ url: "http://api.test/api/v1/meetings/m1/action-items/a1/dismiss", method: "POST", body: { reason: "Trùng" } });
    expect(sent(1).body).toEqual({});
    expect(sent(2).url).toBe("http://api.test/api/v1/meetings/m1/action-items/a1/restore");
  });

  it("link names the item and the task, and shrugs off an answer it cannot read", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await linkMeetingActionItem("m1", "a1", "t9");
    expect(sent(0)).toEqual({ url: "http://api.test/api/v1/meetings/m1/action-items/a1/link", method: "POST", body: { task_id: "t9" } });
    vi.mocked(fetch).mockResolvedValueOnce(json("not an object"));
    await expect(linkMeetingActionItem("m1", "a1", "t9")).resolves.toBeUndefined();
  });

  it("getMeetingCarriedOverItems reads each task with its source meeting", async () => {
    const carried = {
      action_item_id: "a2",
      meeting: { id: "m0", title: "Giao ban tuần trước", started_at: "2026-10-13T02:00:00Z" },
      task: converted.task,
    };
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [carried], total: 4 }));
    const got = await getMeetingCarriedOverItems("m1");
    expect(sent().url).toBe("http://api.test/api/v1/meetings/m1/carried-over-items");
    expect(got).toEqual({ items: [carried], total: 4 });
  });

  it("getMeetingCarriedOverItems drops an entry it cannot read and degrades to empty", async () => {
    const ok = { action_item_id: "a2", meeting: { id: "m0", title: "Họp" }, task: { id: "t1" } };
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [{ action_item_id: "a3", meeting: null, task: { id: "t2" } }, ok] }));
    const got = await getMeetingCarriedOverItems("m1");
    expect(got.items.map((i) => i.action_item_id)).toEqual(["a2"]);
    // No total (an older server) or a broken one reads as the page itself.
    expect(got.total).toBe(1);
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [ok], total: "lots" }));
    expect((await getMeetingCarriedOverItems("m1")).total).toBe(1);
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: "nope" }));
    expect(await getMeetingCarriedOverItems("m1")).toEqual({ items: [], total: 0 });
  });

  it("convertMeetingActionItems sends the body as given and answers null, never zero tasks, on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ links: [{ action_item_id: "a1", task_id: "t1" }] }));
    const body = { items: [{ action_item_id: "a1", assignee_id: null, due_date: null, project_id: "" }] };
    expect(await convertMeetingActionItems("m1", body)).toEqual({ links: [{ action_item_id: "a1", task_id: "t1" }] });
    expect(sent()).toEqual({ url: "http://api.test/api/v1/meetings/m1/action-items/convert", method: "POST", body });
    vi.mocked(fetch).mockResolvedValueOnce(json({ links: "nope" }));
    expect(await convertMeetingActionItems("m1", body)).toBeNull();
  });
});
