// Audit P2 "optimistic-ops-not-overlaid": a refetch that lands before a queued
// wish is delivered must not put the server's older copy back on screen.
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { overlayPendingOps, type OverlayOp } from "./pending-ops-overlay";

const settings = { deadline_at: null, pin_to_top: false, allow_multiple: true, allow_add_options: true, hide_results_until_vote: false, hide_voters: false };
const msg = (id: string, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord =>
  ({ id, room_id: "r1", sender_id: "u2", kind: "text", body: "old", created_at: "2026-10-17T10:00:00Z", reactions: {}, my_reactions: [], ...extra }) as ChatMessageRecord;
const poll = msg("p", { kind: "poll", poll: { question: "?", options: [{ id: "a", label: "A", votes: 0 }], settings, viewer_option_ids: [] } } as unknown as Partial<ChatMessageRecord>);

describe("overlayPendingOps", () => {
  it("hands back the same array when no wish touches the rows", () => {
    const rows = [msg("m1")];
    expect(overlayPendingOps(rows, [], "u1")).toBe(rows);
    expect(overlayPendingOps(rows, [{ kind: "read" }], "u1")).toBe(rows);
    expect(overlayPendingOps(rows, [{ kind: "delete", messageId: "elsewhere" }], "u1")).toBe(rows);
  });

  it("lays a reaction, a vote, an edit and a delete over a fresh server copy", () => {
    const rows = [msg("m1"), msg("m2", { body: "keep" }), poll, msg("gone")];
    const ops: OverlayOp[] = [
      { kind: "reaction", messageId: "m1", emoji: "👍", on: true },
      { kind: "edit", messageId: "m1", body: "new", createdAt: Date.parse("2026-10-17T11:00:00Z") },
      { kind: "vote", messageId: "p", optionIds: ["a"] },
      { kind: "delete", messageId: "gone" },
    ];
    const out = overlayPendingOps(rows, ops, "u1");
    expect(out.map((m) => m.id)).toEqual(["m1", "m2", "p"]);
    expect(out[0]).toMatchObject({ body: "new", edited_at: "2026-10-17T11:00:00.000Z", my_reactions: ["👍"], reactions: { "👍": 1 } });
    // A row without a wish keeps its object.
    expect(out[1]).toBe(rows[1]);
    expect(out[2]?.poll?.viewer_option_ids).toEqual(["a"]);
  });

  it("is a no-op once the server has caught up, and keeps each row's object across renders", () => {
    const done = msg("m1", { body: "new", my_reactions: ["👍"], reactions: { "👍": 1 } });
    const ops: OverlayOp[] = [
      { kind: "reaction", messageId: "m1", emoji: "👍", on: true },
      { kind: "edit", messageId: "m1", body: "new", createdAt: 0 },
    ];
    expect(overlayPendingOps([done], ops, "u1")[0]).toBe(done);

    const stale = msg("m1");
    const first = overlayPendingOps([stale], ops, "u1")[0];
    expect(overlayPendingOps([stale], [...ops], "u1")[0]).toBe(first);
    // Another wish on the same record is drawn anew.
    expect(overlayPendingOps([stale], [{ kind: "reaction", messageId: "m1", emoji: "👍", on: false }], "u1")[0]).toBe(stale);
    expect(overlayPendingOps([stale], [{ kind: "delete", messageId: "m1" }], "u1")).toEqual([]);
  });
});
