import { describe, expect, it, vi } from "vitest";
import { formatSidebarTypingPreview } from "./chat-sidebar-typing";

describe("formatSidebarTypingPreview", () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    if (key === "chat.sidebar_typing") return "Đang nhập…";
    if (key === "chat.typing_one") return `${options?.name as string} đang nhập…`;
    return key;
  };

  it("uses short label for dm rooms", () => {
    expect(
      formatSidebarTypingPreview(["USER_B"], {
        isGroup: false,
        t,
        locale: "vi",
        contacts: [],
      }),
    ).toBe("Đang nhập…");
  });

  it("uses sender names for group rooms", () => {
    expect(
      formatSidebarTypingPreview(["USER_B"], {
        isGroup: true,
        t,
        locale: "vi",
        contacts: [
          {
            user_id: "USER_B",
            email: "b@test.com",
            display_name: "Long",
          },
        ],
      }),
    ).toBe("Long đang nhập…");
  });

  it("uses a known member name when the typist is not a contact", () => {
    const userId = "01M4WJJEDVW2TDT49SB7FYS7D1";
    expect(
      formatSidebarTypingPreview([userId.toLowerCase()], {
        isGroup: true,
        t,
        locale: "vi",
        contacts: [],
        fallbackNameByUserId: { [userId]: "Nam Nguyễn" },
      }),
    ).toBe("Nam Nguyễn đang nhập…");
  });

  it("skips a contact stored under the raw id and uses the known name", () => {
    const userId = "01M4WJJEDVW2TDT49SB7FYS7D1";
    expect(
      formatSidebarTypingPreview([userId], {
        isGroup: true,
        t,
        locale: "vi",
        contacts: [{ user_id: userId, email: "nam@example.com", display_name: userId }],
        fallbackNameByUserId: { [userId]: "Nam Nguyễn" },
      }),
    ).toBe("Nam Nguyễn đang nhập…");
  });

  it("does not print a raw id when the typist has no name", () => {
    expect(
      formatSidebarTypingPreview(["01M4WJJEDVW2TDT49SB7FYS7D1"], {
        isGroup: true,
        t,
        locale: "vi",
        contacts: [],
      }),
    ).toBe("Đang nhập…");
  });

  it("returns null when nobody is typing", () => {
    expect(
      formatSidebarTypingPreview([], {
        isGroup: false,
        t,
        locale: "vi",
        contacts: [],
      }),
    ).toBeNull();
  });
});
