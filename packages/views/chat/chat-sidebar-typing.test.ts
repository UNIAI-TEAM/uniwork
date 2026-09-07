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
