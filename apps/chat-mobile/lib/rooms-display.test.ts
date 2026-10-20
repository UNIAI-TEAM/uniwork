// Parity: the cases of packages/views/chat/chat-sidebar-unified.test.ts and
// chat-sidebar-preview.test.ts, verbatim, then the mobile-only helpers.
import { describe, expect, it } from "vitest";
import {
  applyKnownPeopleToRoomPreviews,
  buildUnifiedSidebarEntries,
  canSendInRoom,
  comparePinnedRoomOrder,
  compareRoomPreviewRecency,
  displayLabelForChatContact,
  formatChatSidebarPreviewText,
  givenNameOf,
  isMissedCallPreview,
  splitChatSidebarPreviewPrefix,
  formatChatSidebarTime,
  resolveChatNicknameForUser,
  sidebarEntryRoomId,
} from "./rooms-display";

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
        "g-room": { pinned: true, pinnedAt: Date.parse("2026-09-01T00:00:00.000Z") },
      },
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
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("dm");
  });

  it("filters to unread and mention rooms (UNI-515)", () => {
    const base = {
      kindFilter: "all" as const,
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
      unreadByRoomId: { dm1: 2, "g-room": 0, ws: 1 },
      mentionUnreadByRoomId: { dm1: 1, "g-room": 0, ws: 0 },
    };

    expect(
      new Set(buildUnifiedSidebarEntries({ ...base, activityFilter: "unread" }).map((e) => e.key)),
    ).toEqual(new Set(["dm:u2", "workspace"]));

    expect(
      buildUnifiedSidebarEntries({ ...base, activityFilter: "mentions" }).map((e) => e.key),
    ).toEqual(["dm:u2"]);
  });
});

describe("chat-sidebar-preview", () => {
  // packages/views/chat/chat-sidebar-preview.test.ts › missed calls, voice length, photos
  it("marks a missed call, lengths a voice note and names a photo (web parity)", () => {
    const base = { senderId: "caller", senderName: "Châu", createdAt: "2026-03-26T10:00:00Z" };
    const options = {
      currentUserId: "me",
      isGroup: false,
      youLabel: "Bạn",
      voiceCallLabel: "Cuộc gọi thoại",
      voiceMessageLabel: "Tin nhắn thoại",
      missedCallLabel: "Cuộc gọi nhỡ",
      mediaLabels: { sticker: "Nhãn dán", gif: "GIF", image: "Ảnh" },
    };
    const call = { ...base, body: "", kind: "voice_call_log", callOutcome: "unanswered" };
    expect(isMissedCallPreview(call, "me")).toBe(true);
    expect(formatChatSidebarPreviewText(call, options)).toBe("Cuộc gọi nhỡ");
    expect(isMissedCallPreview(call, "CALLER")).toBe(false);
    expect(formatChatSidebarPreviewText({ ...call, callOutcome: "completed" }, options)).toBe("Cuộc gọi thoại");
    expect(formatChatSidebarPreviewText({ ...base, body: "", kind: "voice", durationMs: 41200 }, options)).toBe("Tin nhắn thoại · 0:42");
    expect(formatChatSidebarPreviewText({ ...base, body: "", kind: "voice" }, options)).toBe("Tin nhắn thoại");
    expect(formatChatSidebarPreviewText({ ...base, body: "IMG_0042.JPG", kind: "file" }, options)).toBe("Ảnh");
    expect(formatChatSidebarPreviewText({ ...base, body: "bao-gia.pdf", kind: "file" }, options)).toBe("bao-gia.pdf");
  });

  it("prefixes a group line with the sender's given name and splits it back off", () => {
    const preview = { body: "xem giúp", kind: "text", senderId: "u2", senderName: "Bùi Minh Quân", createdAt: "2026-03-26T10:00:00Z" };
    const options = { currentUserId: "me", isGroup: true, youLabel: "Bạn", voiceCallLabel: "Cuộc gọi" };
    const group = formatChatSidebarPreviewText(preview, options);
    const body = formatChatSidebarPreviewText(preview, { ...options, isGroup: false });
    expect(group).toBe("Quân: xem giúp");
    expect(splitChatSidebarPreviewPrefix(group, body)).toEqual({ prefix: "Quân: ", body: "xem giúp" });
    expect(splitChatSidebarPreviewPrefix("xem giúp", "xem giúp")).toEqual({ prefix: null, body: "xem giúp" });
    expect(splitChatSidebarPreviewPrefix(null, null)).toEqual({ prefix: null, body: null });
    expect(givenNameOf("Phòng HC")).toBe("Phòng HC");
    expect(givenNameOf("Hà")).toBe("Hà");
  });

  it("formats group preview with sender prefix", () => {
    const text = formatChatSidebarPreviewText(
      {
        body: "[@Binh](mention://member/u2) hello",
        kind: "text",
        senderId: "u2",
        senderName: "Binh",
        createdAt: "2026-03-26T10:00:00Z",
      },
      {
        currentUserId: "self",
        isGroup: true,
        youLabel: "Bạn",
        voiceCallLabel: "Cuộc gọi",
      },
    );
    expect(text).toBe("Binh: @Binh hello");
  });

  it("uses nicknames in group preview sender prefix", () => {
    const text = formatChatSidebarPreviewText(
      {
        body: "hello",
        kind: "text",
        senderId: "u2",
        senderName: "Tran Hoang Long",
        createdAt: "2026-03-26T10:00:00Z",
      },
      {
        currentUserId: "self",
        isGroup: true,
        youLabel: "Bạn",
        voiceCallLabel: "Cuộc gọi",
        nicknamesByUserId: { u2: "Long" },
      },
    );
    expect(text).toBe("Long: hello");
  });

  it("formats dm preview without sender prefix", () => {
    const text = formatChatSidebarPreviewText(
      {
        body: "xin chao",
        kind: "text",
        senderId: "u2",
        senderName: "Binh",
        createdAt: "2026-03-26T10:00:00Z",
      },
      {
        currentUserId: "self",
        isGroup: false,
        youLabel: "Bạn",
        voiceCallLabel: "Cuộc gọi",
      },
    );
    expect(text).toBe("xin chao");
  });

  it("uses the localized voice message preview", () => {
    const text = formatChatSidebarPreviewText(
      {
        body: "",
        kind: "voice",
        senderId: "u2",
        senderName: "Binh",
        createdAt: "2026-03-26T10:00:00Z",
      },
      {
        currentUserId: "self",
        isGroup: false,
        youLabel: "Bạn",
        voiceCallLabel: "Cuộc gọi",
        voiceMessageLabel: "Tin nhắn thoại",
      },
    );
    expect(text).toBe("Tin nhắn thoại");
  });

  it("prefers file name in file preview, else localized label", () => {
    expect(
      formatChatSidebarPreviewText(
        {
          body: "sprint.pdf",
          kind: "file",
          senderId: "u2",
          senderName: "Binh",
          createdAt: "2026-03-26T10:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: false,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
          fileMessageLabel: "Tệp đính kèm",
        },
      ),
    ).toBe("sprint.pdf");
    expect(
      formatChatSidebarPreviewText(
        {
          body: "  ",
          kind: "file",
          senderId: "u2",
          senderName: "Binh",
          createdAt: "2026-03-26T10:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: false,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
          fileMessageLabel: "Tệp đính kèm",
        },
      ),
    ).toBe("Tệp đính kèm");
  });

  it("sorts previews by recency", () => {
    const newer = {
      body: "b",
      kind: "text",
      senderId: "u1",
      senderName: "A",
      createdAt: "2026-03-27T10:00:00Z",
    };
    const older = {
      body: "a",
      kind: "text",
      senderId: "u1",
      senderName: "A",
      createdAt: "2026-03-26T10:00:00Z",
    };
    expect(compareRoomPreviewRecency(newer, older)).toBeLessThan(0);
  });

  it("formats today as time and yesterday label", () => {
    const now = new Date("2026-03-26T15:00:00Z");
    expect(
      formatChatSidebarTime("2026-03-26T10:30:00Z", {
        now,
        yesterdayLabel: "Hôm qua",
      }),
    ).toMatch(/\d/);
    expect(
      formatChatSidebarTime("2026-03-25T10:30:00Z", {
        now,
        yesterdayLabel: "Hôm qua",
      }),
    ).toBe("Hôm qua");
  });

  it("returns null for missing previews and empty bodies", () => {
    expect(
      formatChatSidebarPreviewText(null, {
        currentUserId: "self",
        isGroup: false,
        youLabel: "Bạn",
        voiceCallLabel: "Cuộc gọi",
      }),
    ).toBeNull();
    expect(
      formatChatSidebarPreviewText(
        {
          body: "   ",
          kind: "text",
          senderId: "u2",
          senderName: "Binh",
          createdAt: "2026-03-26T10:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: false,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
        },
      ),
    ).toBeNull();
  });

  it("formats voice call logs and falls back for voice/file labels", () => {
    expect(
      formatChatSidebarPreviewText(
        {
          body: "",
          kind: "voice_call_log",
          senderId: "u2",
          senderName: "Binh",
          createdAt: "2026-03-26T10:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: false,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
        },
      ),
    ).toBe("Cuộc gọi");
    expect(
      formatChatSidebarPreviewText(
        {
          body: "",
          kind: "voice",
          senderId: "u2",
          senderName: "Binh",
          createdAt: "2026-03-26T10:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: false,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
        },
      ),
    ).toBe("Cuộc gọi");
    expect(
      formatChatSidebarPreviewText(
        {
          body: "  ",
          kind: "file",
          senderId: "u2",
          senderName: "Binh",
          createdAt: "2026-03-26T10:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: false,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
        },
      ),
    ).toBeNull();
  });

  it("prefixes group self messages with youLabel or nickname", () => {
    expect(
      formatChatSidebarPreviewText(
        {
          body: "mine",
          kind: "text",
          senderId: "SELF",
          senderName: "Me",
          createdAt: "2026-03-26T10:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: true,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
        },
      ),
    ).toBe("Bạn: mine");
    expect(
      formatChatSidebarPreviewText(
        {
          body: "mine",
          kind: "text",
          senderId: "self",
          senderName: "Me",
          createdAt: "2026-03-26T10:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: true,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
          nicknamesByUserId: { self: "Tôi" },
        },
      ),
    ).toBe("Tôi: mine");
    expect(
      formatChatSidebarPreviewText(
        {
          body: "peer",
          kind: "text",
          senderId: "u9",
          senderName: "  ",
          createdAt: "2026-03-26T10:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: true,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
        },
      ),
    ).toBe("peer");
    expect(
      formatChatSidebarPreviewText(
        {
          body: "Sửa tối ưu phần chat",
          kind: "text",
          senderId: "01M4WJJEDVW2TDT49SB7FYS7D1",
          senderName: "01M4WJJEDVW2TDT49SB7FYS7D1",
          createdAt: "2026-03-26T10:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: true,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
        },
      ),
    ).toBe("Sửa tối ưu phần chat");
  });

  it("formats weekday and full date buckets for sidebar time", () => {
    const now = new Date("2026-03-26T15:00:00Z");
    expect(
      formatChatSidebarTime("2026-03-24T10:30:00Z", {
        now,
        yesterdayLabel: "Hôm qua",
      }),
    ).toMatch(/\w/);
    expect(
      formatChatSidebarTime("2026-03-01T10:30:00Z", {
        now,
        yesterdayLabel: "Hôm qua",
      }),
    ).toMatch(/\d/);
    expect(formatChatSidebarTime(undefined, { now, yesterdayLabel: "Hôm qua" })).toBeNull();
    expect(formatChatSidebarTime("  ", { now, yesterdayLabel: "Hôm qua" })).toBeNull();
    expect(formatChatSidebarTime("not-a-date", { now, yesterdayLabel: "Hôm qua" })).toBeNull();
  });

  it("compares missing createdAt as epoch zero", () => {
    expect(compareRoomPreviewRecency(null, null)).toBe(0);
    expect(
      compareRoomPreviewRecency(
        {
          body: "a",
          kind: "text",
          senderId: "u1",
          senderName: "A",
          createdAt: "",
        },
        {
          body: "b",
          kind: "text",
          senderId: "u1",
          senderName: "A",
          createdAt: "2026-03-26T10:00:00Z",
        },
      ),
    ).toBeGreaterThan(0);
  });

  it("uses a known name when the preview only has the sender id", () => {
    const senderId = "01M4W8BRMSRN6FBD2XM7WEM8";
    const previews = applyKnownPeopleToRoomPreviews(
      {
        room1: {
          body: `[@${senderId}](mention://member/${senderId}) xem giúp`,
          kind: "text",
          senderId,
          senderName: "",
          createdAt: "2026-03-26T10:00:00Z",
        },
      },
      [{ user_id: senderId.toLowerCase(), display_name: "Trà My Đào" }],
    );
    expect(
      formatChatSidebarPreviewText(previews.room1, {
        currentUserId: "me",
        isGroup: true,
        youLabel: "Bạn",
        voiceCallLabel: "Cuộc gọi",
      }),
    ).toBe("Đào: @Trà My Đào xem giúp");
  });

  it("shows a sticker as words, never as its markdown", () => {
    expect(
      formatChatSidebarPreviewText(
        {
          body: "![sticker:ăn mừng](https://media.giphy.com/a.webp)",
          kind: "text",
          senderId: "self",
          senderName: "Minh",
          createdAt: "2026-09-21T09:00:00Z",
        },
        {
          currentUserId: "self",
          isGroup: true,
          youLabel: "Bạn",
          voiceCallLabel: "Cuộc gọi",
          mediaLabels: { sticker: "Nhãn dán", gif: "GIF", image: "Hình ảnh" },
        },
      ),
    ).toBe("Bạn: Nhãn dán · ăn mừng");
  });
});

describe("buildUnifiedSidebarEntries filters (mobile search field)", () => {
  const channel = (id: string, name: string, topic?: string) =>
    ({ id, name, topic, kind: "channel" }) as Parameters<typeof buildUnifiedSidebarEntries>[0]["channels"][number];
  const base = {
    kindFilter: "all" as const,
    workspaceTitle: "Chung",
    workspaceRoomId: null,
    channels: [channel("c1", "thiet-ke"), channel("c2", "sales", "Thiết kế bán hàng"), channel("c3", "ops")],
    groups: [{ id: "g1", name: "Đội Thiết kế", room_id: "g-room", member_user_ids: [] }, { id: "g2", name: "Kho", room_id: "g2", member_user_ids: [] }],
    contacts: [
      { user_id: "u1", email: "thietke@x.vn", display_name: "Lan" },
      { user_id: "u2", email: "minh@x.vn", display_name: "Minh", dm_room_id: "dm2" },
    ],
    nicknamesByUserId: {},
    roomPreviewsByRoomId: {},
    pinnedByRoomId: {},
  };

  it("matches channel names and topics, group names and contact emails, accent-insensitively", () => {
    const keys = buildUnifiedSidebarEntries({ ...base, filterText: "thiet ke" }).map((e) => e.key);
    expect(new Set(keys)).toEqual(new Set(["channel:c1", "channel:c2", "group:g1", "dm:u1"]));
  });

  it("narrows to one kind", () => {
    expect(buildUnifiedSidebarEntries({ ...base, filterText: "", kindFilter: "channel" }).map((e) => e.kind)).toEqual([
      "channel",
      "channel",
      "channel",
    ]);
  });

  it("lists the workspace room even before it exists, and drops a room-less DM from activity filters", () => {
    const all = buildUnifiedSidebarEntries({ ...base, filterText: "" });
    expect(all.find((e) => e.key === "workspace")).toMatchObject({ roomId: null, sortRoomId: "" });
    const unread = buildUnifiedSidebarEntries({ ...base, filterText: "", activityFilter: "unread", unreadByRoomId: { dm2: 1 } });
    expect(unread.map((e) => e.key)).toEqual(["dm:u2"]);
    const mentions = buildUnifiedSidebarEntries({ ...base, filterText: "", activityFilter: "mentions" });
    expect(mentions).toEqual([]);
  });
});

describe("formatChatSidebarTime without an explicit now", () => {
  it("reads today against the clock, reusing one formatter per locale and shape", () => {
    const iso = new Date().toISOString();
    expect(formatChatSidebarTime(iso, { yesterdayLabel: "Hôm qua", locale: "vi" })).toMatch(/\d{2}:\d{2}/);
    expect(formatChatSidebarTime(iso, { yesterdayLabel: "Hôm qua", locale: "vi" })).toMatch(/\d{2}:\d{2}/);
  });
});

describe("applyKnownPeopleToRoomPreviews edge cases", () => {
  const id = "01M4WJJEDVW2TDT49SB7FYS7D1";
  const other = "01M4WJJEDVW2TDT49SB7FYS7D2";
  const preview = (body: string, senderId = "u9", senderName = "Old") => ({
    body,
    kind: "text",
    senderId,
    senderName,
    createdAt: "2026-09-11T12:00:00.000Z",
  });

  it("hands back the same map when nobody has a human name", () => {
    const previews = { r1: preview("hi") };
    expect(applyKnownPeopleToRoomPreviews(previews, [{ user_id: id, display_name: id }, { user_id: " ", display_name: "X" }])).toBe(previews);
  });

  it("names a bare @id mention when the person is known", () => {
    const out = applyKnownPeopleToRoomPreviews({ r1: preview(`hỏi @${id} nhé`) }, [{ user_id: id, display_name: "Lan Anh" }]);
    expect(out.r1?.body).toBe("hỏi @Lan Anh nhé");
  });

  it("keeps an unknown sender's name and mentions that already carry a name or an unknown id", () => {
    const out = applyKnownPeopleToRoomPreviews(
      { r1: preview(`[@Lan](mention://member/${id}) [@${other}](mention://member/${other}) @${other}`) },
      [{ user_id: id, display_name: "Lan Anh" }],
    );
    expect(out.r1).toMatchObject({
      senderName: "Old",
      body: `[@Lan](mention://member/${id}) [@${other}](mention://member/${other}) @${other}`,
    });
  });
});

describe("contact labels and nicknames (core contacts-store parity)", () => {
  it("resolves a nickname whatever the casing of its key, and ignores blank ones", () => {
    expect(resolveChatNicknameForUser(undefined, "u1")).toBeUndefined();
    expect(resolveChatNicknameForUser({ u1: " Bé " }, "u1")).toBe("Bé");
    expect(resolveChatNicknameForUser({ U1: "Bé" }, "u1")).toBe("Bé");
    expect(resolveChatNicknameForUser({ U1: "  ", u2: "x" }, "u1")).toBeUndefined();
  });

  it("prefers nickname, then a real name, then the email, then whatever is left", () => {
    const id = "01M4WJJEDVW2TDT49SB7FYS7D1";
    expect(displayLabelForChatContact({ user_id: id, display_name: "Nam", email: "n@x.vn" }, { [id]: "Anh Nam" })).toBe("Anh Nam");
    expect(displayLabelForChatContact({ user_id: id, display_name: "Nam", email: "n@x.vn" })).toBe("Nam");
    expect(displayLabelForChatContact({ user_id: id, display_name: id, email: "n@x.vn" })).toBe("n@x.vn");
    expect(displayLabelForChatContact({ user_id: id, display_name: id, email: " " })).toBe(id);
  });
});

describe("comparePinnedRoomOrder (core room-preferences-store parity)", () => {
  it("puts pinned first, the latest pin first, and leaves the rest to recency", () => {
    const prefs = { a: { pinned: true, pinnedAt: 1 }, b: { pinned: true, pinnedAt: 2 }, c: { pinned: false, pinnedAt: 0 } };
    expect(comparePinnedRoomOrder("a", "c", prefs)).toBeLessThan(0);
    expect(comparePinnedRoomOrder("c", "a", prefs)).toBeGreaterThan(0);
    expect(comparePinnedRoomOrder("a", "b", prefs)).toBeGreaterThan(0);
    expect(comparePinnedRoomOrder("c", "d", prefs)).toBe(0);
  });
});

describe("sidebarEntryRoomId", () => {
  it("names the room each kind of entry opens", () => {
    const channel = { id: "c1" } as Parameters<typeof buildUnifiedSidebarEntries>[0]["channels"][number];
    expect(sidebarEntryRoomId({ key: "workspace", kind: "workspace", roomId: "ws", sortRoomId: "ws" })).toBe("ws");
    expect(sidebarEntryRoomId({ key: "channel:c1", kind: "channel", channel, sortRoomId: "c1" })).toBe("c1");
    expect(
      sidebarEntryRoomId({ key: "group:g", kind: "group", group: { id: "g", name: "G", room_id: "gr", member_user_ids: [] }, sortRoomId: "gr" }),
    ).toBe("gr");
    expect(
      sidebarEntryRoomId({ key: "dm:u", kind: "dm", contact: { user_id: "u", email: "", display_name: "U" }, sortRoomId: "" }),
    ).toBeNull();
  });
});

describe("canSendInRoom (web use-resolved-room-permissions parity)", () => {
  const member = (user_id: string, extra: Partial<{ role: string; send_restricted: boolean; is_creator: boolean }> = {}) => ({
    user_id,
    role: "member",
    send_restricted: false,
    email: "",
    display_name: "",
    is_creator: false,
    ...extra,
  });
  const closed = {
    allow_change_profile: true,
    allow_pin_content: true,
    allow_create_notes: true,
    allow_create_polls: true,
    allow_send_messages: false,
    allow_forward: true,
  };

  it("sends by default, and not when the room closes sending or the caller is restricted", () => {
    expect(canSendInRoom(null, [], "me")).toBe(true);
    expect(canSendInRoom({ kind: "group", member_permissions: closed }, [member("me")], "me")).toBe(false);
    expect(canSendInRoom({ kind: "dm" }, [member("me", { send_restricted: true })], "me")).toBe(false);
  });

  it("lets a room admin and a group's creator past the flags", () => {
    expect(canSendInRoom({ kind: "channel", member_permissions: closed }, [member("ME", { role: "admin" })], "me")).toBe(true);
    expect(canSendInRoom({ kind: "group", member_permissions: closed }, [member("me", { is_creator: true })], "me")).toBe(true);
    expect(canSendInRoom({ kind: "channel", member_permissions: closed }, [member("me", { is_creator: true })], "me")).toBe(false);
  });
});
