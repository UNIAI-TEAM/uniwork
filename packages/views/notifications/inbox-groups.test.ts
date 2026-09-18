import { describe, expect, it } from "vitest";
import type { Notification } from "@uniwork/core/types";
import { groupInbox } from "./inbox-groups";

const n = (id: string, created_at: string, read = true): Notification => ({
  id, kind: "task_assigned", workspace_id: "ws1", organization_id: "o1", resource_type: "task", resource_id: "t",
  resource_deleted: false, actor_kind: "human", actor_id: "u", title_key: "k", params: {}, count: 1, created_at,
  ...(read ? { read_at: created_at } : {}),
});

describe("groupInbox", () => {
  // Local noon, so the day boundaries below hold in any test timezone.
  const now = new Date(2026, 8, 18, 12, 0, 0);
  const at = (days: number, hour = 9) => new Date(2026, 8, 18 - days, hour).toISOString();

  it("puts unread first, then read rows by the viewer's day, dropping empty groups", () => {
    const groups = groupInbox(
      [n("u1", at(3), false), n("t1", at(0)), n("y1", at(1, 23)), n("w1", at(6)), n("o1", at(7)), n("u2", at(0), false)],
      now,
    );
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["unread", ["u1", "u2"]],
      ["today", ["t1"]],
      ["yesterday", ["y1"]],
      ["week", ["w1"]],
      ["older", ["o1"]],
    ]);
    expect(groupInbox([n("t1", at(0))], now).map((g) => g.key)).toEqual(["today"]);
  });

  it("keeps a pinned row in its recorded group whatever its read state", () => {
    const groups = groupInbox([n("r1", at(0)), n("u1", at(2), false)], now, new Map([["r1", "unread"], ["u1", "week"]] as const));
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["unread", ["r1"]],
      ["week", ["u1"]],
    ]);
  });
});
