import { describe, expect, it } from "vitest";
import {
  compareRoomPreviewRecency,
  formatChatSidebarPreviewText,
  formatChatSidebarTime,
} from "./chat-sidebar-preview";

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
    ).toBe("u9: peer");
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
});
