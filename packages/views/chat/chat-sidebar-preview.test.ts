import { describe, expect, it } from "vitest";
import {
  applyKnownPeopleToRoomPreviews,
  chatSidebarPreviewIcon,
  compareRoomPreviewRecency,
  isMissedCallPreview,
  formatChatSidebarPreviewText,
  formatChatSidebarTime,
} from "./chat-sidebar-preview";
import { givenNameOf, initialsOf, roomInitialsOf } from "./chat-initials";

describe("chat-sidebar-preview", () => {
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
    // Vietnamese weekdays read "T2"; this year's dates drop the year.
    expect(formatChatSidebarTime("2026-03-23T10:30:00Z", { now, yesterdayLabel: "Hôm qua", locale: "vi" })).toBe("T2");
    expect(formatChatSidebarTime("2026-03-01T10:30:00Z", { now, yesterdayLabel: "Hôm qua", locale: "vi" })).toBe("1/3");
    expect(formatChatSidebarTime("2025-12-01T10:30:00Z", { now, yesterdayLabel: "Hôm qua", locale: "vi" })).toBe("1/12/2025");
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
      [{ user_id: senderId.toLowerCase(), display_name: "Đào Trà My" }],
    );
    expect(
      formatChatSidebarPreviewText(previews.room1, {
        currentUserId: "me",
        isGroup: true,
        youLabel: "Bạn",
        voiceCallLabel: "Cuộc gọi",
      }),
    ).toBe("My: @Đào Trà My xem giúp");
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

  it("names the sender of a group voice note or photo, and says Photo for an image file", () => {
    const base = { senderId: "u2", senderName: "Tuấn", createdAt: "2026-03-26T10:00:00Z" };
    const options = {
      currentUserId: "self",
      isGroup: true,
      youLabel: "Bạn",
      voiceCallLabel: "Cuộc gọi",
      voiceMessageLabel: "Tin nhắn thoại",
      mediaLabels: { sticker: "Sticker", gif: "GIF", image: "Ảnh" },
    };
    expect(formatChatSidebarPreviewText({ ...base, body: "", kind: "voice" }, options)).toBe("Tuấn: Tin nhắn thoại");
    expect(formatChatSidebarPreviewText({ ...base, body: "IMG_01.JPG", kind: "file" }, options)).toBe("Tuấn: Ảnh");
    expect(formatChatSidebarPreviewText({ ...base, body: "plan.pdf", kind: "file" }, options)).toBe("Tuấn: plan.pdf");
    expect(formatChatSidebarPreviewText({ ...base, body: "", kind: "voice_call_log" }, options)).toBe("Cuộc gọi");
  });

  it("says a missed call only to whoever it rang for, and gives a voice note its length", () => {
    const base = { senderId: "caller", senderName: "Châu", createdAt: "2026-03-26T10:00:00Z" };
    const options = {
      currentUserId: "me",
      isGroup: false,
      youLabel: "Bạn",
      voiceCallLabel: "Cuộc gọi thoại",
      voiceMessageLabel: "Tin nhắn thoại",
      missedCallLabel: "Cuộc gọi nhỡ",
    };
    const call = { ...base, body: "", kind: "voice_call_log", callOutcome: "unanswered" };
    expect(isMissedCallPreview(call, "me")).toBe(true);
    expect(formatChatSidebarPreviewText(call, options)).toBe("Cuộc gọi nhỡ");
    // The caller's own unanswered call, or an answered one, is not missed.
    expect(isMissedCallPreview(call, "CALLER")).toBe(false);
    expect(formatChatSidebarPreviewText({ ...call, callOutcome: "completed" }, options)).toBe("Cuộc gọi thoại");
    expect(formatChatSidebarPreviewText({ ...base, body: "", kind: "voice", durationMs: 41200 }, options)).toBe(
      "Tin nhắn thoại · 0:42",
    );
    expect(formatChatSidebarPreviewText({ ...base, body: "", kind: "voice" }, options)).toBe("Tin nhắn thoại");
  });

  it("picks the glyph a row draws before its preview", () => {
    const base = { senderId: "u2", senderName: "A", createdAt: "2026-03-26T10:00:00Z" };
    expect(chatSidebarPreviewIcon({ ...base, body: "", kind: "voice" })).toBe("voice");
    expect(chatSidebarPreviewIcon({ ...base, body: "", kind: "voice_call_log" })).toBe("call");
    expect(chatSidebarPreviewIcon({ ...base, body: "a.webp", kind: "file" })).toBe("image");
    expect(chatSidebarPreviewIcon({ ...base, body: "a.zip", kind: "file" })).toBe("file");
    expect(chatSidebarPreviewIcon({ ...base, body: "hello", kind: "text" })).toBeNull();
    expect(chatSidebarPreviewIcon(undefined)).toBeNull();
  });

  it("takes a face's two letters from the last two words", () => {
    expect(initialsOf("Nguyễn Thu Hà")).toBe("TH");
    expect(initialsOf("Trần Đức Anh")).toBe("ĐA");
    expect(initialsOf("Võ Minh")).toBe("VM");
    expect(initialsOf("binh")).toBe("B");
    expect(initialsOf("  ")).toBe("?");
    // A room reads from its first words, past a leading "Đội".
    expect(roomInitialsOf("Ra mắt UniWork Q4")).toBe("RM");
    expect(roomInitialsOf("Đội Thiết kế")).toBe("TK");
    expect(roomInitialsOf("Nhóm thiết kế")).toBe("NT");
    expect(roomInitialsOf("Đội")).toBe("Đ");
    expect(roomInitialsOf("design")).toBe("D");
    // A list line calls a person by the given name; an acronym tail keeps the whole name.
    expect(givenNameOf("Bùi Minh Quân")).toBe("Quân");
    expect(givenNameOf("Phòng HC")).toBe("Phòng HC");
    expect(givenNameOf("Binh")).toBe("Binh");
  });
});
