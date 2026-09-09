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
});
