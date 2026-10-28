import { describe, expect, it } from "vitest";
import type { MeetingActionItem } from "@uniwork/core/api/endpoints/meeting-action-items";
import type { Meeting, MeetingActivityItem, MeetingSummary } from "@uniwork/core/types";
import { endedFacts } from "./exit-ended-model";

const meeting = {
  id: "m1",
  actual_start_at: "2026-10-27T08:40:00Z",
  actual_end_at: "2026-10-27T09:21:00Z",
} as Meeting;

const activity = (event_type: string, actor_id: string, occurred_at: string): MeetingActivityItem => ({
  id: `${event_type}-${occurred_at}`, event_type, actor_id, occurred_at,
});

const item = (id: string, over: Partial<MeetingActionItem>): MeetingActionItem =>
  ({ id, title: id, status: "PENDING", evidence: [], ...over }) as MeetingActionItem;

const base = {
  meeting,
  activity: [] as MeetingActivityItem[],
  attendance: undefined,
  recordings: [],
  actionItems: [] as MeetingActionItem[],
  summary: null,
  viewerId: "u-me",
};

describe("endedFacts", () => {
  it("names who ended it, from the latest MEETING_ENDED", () => {
    const facts = endedFacts({
      ...base,
      activity: [activity("MEETING_STARTED", "u-a", "2026-10-27T08:40:00Z"), activity("MEETING_ENDED", "u-host", "2026-10-27T09:21:00Z")],
    });
    expect(facts.endedBy).toEqual({ kind: "person", userId: "u-host" });
    expect(facts.endedAt).toBe("2026-10-27T09:21:00Z");
    expect(facts.durationMinutes).toBe(41);
  });

  it("says when the clock ended it, and nothing before the timeline arrives", () => {
    expect(endedFacts({ ...base, activity: [activity("MEETING_AUTO_ENDED", "system", "2026-10-27T11:40:00Z")] }).endedBy).toEqual({
      kind: "auto",
    });
    expect(endedFacts(base).endedBy).toBeNull();
  });

  it("counts present people, the recording and what the scribe caught", () => {
    const facts = endedFacts({
      ...base,
      attendance: { summary: { members: 7, present: 5, late: 1, excused: 0, absent: 1 }, rows: [] } as never,
      recordings: [{ id: "r1", meeting_id: "m1", status: "PROCESSING", started_at: "2026-10-27T08:42:00Z", ended_at: "2026-10-27T09:20:12Z" }],
      summary: {
        id: "s1", meeting_id: "m1", summary: "",
        decisions: [{ text: "Chốt giá", evidence: [] }, { text: "Giữ lịch", evidence: [] }, { text: "Mở rộng", evidence: [] }],
        open_questions: [{ text: "Ai lo QA?", evidence: [] }],
      } as unknown as MeetingSummary,
      actionItems: [item("a", {}), item("b", { status: "CONVERTED" }), item("c", { status: "DISMISSED" as never })],
    });
    expect(facts.present).toBe(6);
    expect(facts.recording).toEqual({ seconds: 38 * 60 + 12, processing: true });
    expect(facts.counts).toEqual({ decision: 3, task: 2, question: 1 });
  });

  it("keeps only the viewer's own items, by assignee or by suggestion", () => {
    const facts = endedFacts({
      ...base,
      actionItems: [
        item("mine-suggested", { title: "Gửi báo giá", suggested_assignee_id: "u-me", suggested_due_date: "2026-10-30" }),
        item("mine-task", { title: "Cập nhật timeline", status: "CONVERTED", task: { id: "t1", assignee_id: "u-me", due_date: "2026-10-31" } }),
        item("theirs", { suggested_assignee_id: "u-other" }),
        item("dismissed", { suggested_assignee_id: "u-me", status: "DISMISSED" as never }),
      ],
    });
    expect(facts.mine).toEqual([
      { id: "mine-suggested", title: "Gửi báo giá", due: "2026-10-30" },
      { id: "mine-task", title: "Cập nhật timeline", due: "2026-10-31" },
    ]);
  });
});
