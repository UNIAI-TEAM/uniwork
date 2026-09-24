import { describe, expect, it } from "vitest";
import { buildUnifiedSidebarEntries } from "./chat-sidebar-unified";

describe("buildUnifiedSidebarEntries", () => {
  it("sorts pinned then recent across kinds into one list", () => {
    const entries = buildUnifiedSidebarEntries({
      kindFilter: "all",
      filterText: "",
      workspaceTitle: "General",
      workspaceRoomId: "ws",
      channels: [],
      groups: [
        {
          id: "g1",
          name: "Design",
          room_id: "g-room",
          member_user_ids: ["u1"],
        },
      ],
      contacts: [
        {
          user_id: "u2",
          email: "a@example.com",
          display_name: "Binh",
          dm_room_id: "dm1",
        },
      ],
      nicknamesByUserId: {},
      roomPreviewsByRoomId: {
        dm1: {
          body: "hi",
          kind: "text",
          senderId: "u2",
          senderName: "Binh",
          createdAt: "2026-09-11T12:00:00.000Z",
        },
        "g-room": {
          body: "old",
          kind: "text",
          senderId: "u1",
          senderName: "A",
          createdAt: "2026-09-10T12:00:00.000Z",
        },
        ws: {
          body: "mid",
          kind: "text",
          senderId: "u1",
          senderName: "A",
          createdAt: "2026-09-11T10:00:00.000Z",
        },
      },
      pinnedByRoomId: {
        "g-room": { pinned: true, notificationsMuted: false, pinnedAt: Date.parse("2026-09-01T00:00:00.000Z") },
      },
      workHubEnabled: false,
    });

    expect(entries.map((e) => e.key)).toEqual(["group:g1", "dm:u2", "workspace"]);
  });

  it("applies kind filter", () => {
    const entries = buildUnifiedSidebarEntries({
      kindFilter: "dm",
      filterText: "",
      workspaceTitle: "General",
      workspaceRoomId: "ws",
      channels: [],
      groups: [
        {
          id: "g1",
          name: "Design",
          room_id: "g-room",
          member_user_ids: ["u1"],
        },
      ],
      contacts: [
        {
          user_id: "u2",
          email: "a@example.com",
          display_name: "Binh",
          dm_room_id: "dm1",
        },
      ],
      nicknamesByUserId: {},
      roomPreviewsByRoomId: {},
      pinnedByRoomId: {},
      workHubEnabled: false,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("dm");
  });
});
