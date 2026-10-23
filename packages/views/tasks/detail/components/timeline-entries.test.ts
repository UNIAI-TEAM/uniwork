import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@uniwork/core/types";
import { groupTimelineEntries, type TimelineSourceEntry } from "./timeline-entries";

function event(id: string): AuditEvent {
  return {
    id,
    organization_id: "o1",
    actor_kind: "human",
    actor_id: "u1",
    action: "task.updated",
    resource_type: "task",
    resource_id: "t1",
    changes: {},
    metadata: {},
    correlation_id: "x",
    occurred_at: `2026-09-12T09:00:${id.padStart(2, "0")}Z`,
  };
}

describe("groupTimelineEntries", () => {
  it("gom activity liên tiếp nhưng giữ bình luận thành thẻ độc lập", () => {
    const entries: TimelineSourceEntry<{ id: string }>[] = [
      { kind: "activity", at: "1", event: event("1") },
      { kind: "activity", at: "2", event: event("2") },
      { kind: "comment", at: "3", thread: { id: "c1" } },
      { kind: "activity", at: "4", event: event("4") },
    ];

    const grouped = groupTimelineEntries(entries);
    expect(grouped.map((entry) => entry.kind)).toEqual([
      "activity-group",
      "comment",
      "activity-group",
    ]);
    expect(grouped[0]?.kind === "activity-group" && grouped[0].events).toHaveLength(2);
    expect(grouped[2]?.kind === "activity-group" && grouped[2].events).toHaveLength(1);
  });
});
