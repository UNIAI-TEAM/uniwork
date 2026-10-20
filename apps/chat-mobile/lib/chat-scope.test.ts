// Parity with packages/views/chat/chat-sidebar.test.tsx › "lists DMs and groups
// in messages, the workspace room and channels in a workspace".
import { describe, expect, it } from "vitest";
import { ROOM_LIST_FILTERS_BY_SCOPE, rowInScope, scopeRows } from "./chat-scope";
import type { RoomListRow } from "./room-list";

const row = (kind: RoomListRow["entry"]["kind"]) => ({ entry: { kind } }) as Pick<RoomListRow, "entry">;

describe("rowInScope", () => {
  it("keeps DMs and groups in messages, the workspace room and channels in a workspace", () => {
    expect(["dm", "group", "workspace", "channel"].filter((kind) => rowInScope("messages", row(kind as never)))).toEqual(["dm", "group"]);
    expect(["dm", "group", "workspace", "channel"].filter((kind) => rowInScope("workspace", row(kind as never)))).toEqual(["workspace", "channel"]);
  });

  it("puts the workspace's own room first in a workspace, and keeps the list order otherwise", () => {
    const rows = [row("channel"), row("dm"), row("workspace"), row("group")].map((r, i) => ({ ...r, i }));
    expect(scopeRows("workspace", rows).map((r) => r.entry.kind)).toEqual(["workspace", "channel"]);
    expect(scopeRows("messages", rows).map((r) => r.i)).toEqual([1, 3]);
  });

  it("offers a kind chip only where the scope holds two kinds", () => {
    expect(ROOM_LIST_FILTERS_BY_SCOPE.messages).toContain("group");
    expect(ROOM_LIST_FILTERS_BY_SCOPE.workspace).not.toContain("channel");
  });
});
