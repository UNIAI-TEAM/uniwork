// Parity: the cases of packages/views/chat/chat-sidebar-typing.test.ts and
// typing-indicator.test.ts (with the app's own i18n bundle, which carries the
// web's chat copy).
import { afterAll, describe, expect, it } from "vitest";
import { i18n } from "./i18n/singleton";
import { formatSidebarTypingPreview, formatTypingLabel, typingNameByUserIdFromContext } from "./typing-display";

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

describe("formatTypingLabel", () => {
  it("returns null for empty list", () => {
    expect(formatTypingLabel([], i18n.t.bind(i18n), "vi")).toBeNull();
  });

  it("shows a single name", () => {
    expect(formatTypingLabel(["B"], i18n.t.bind(i18n), "vi")).toBe("B đang nhập…");
  });

  it("lists multiple names in Vietnamese", async () => {
    await i18n.changeLanguage("vi");
    expect(formatTypingLabel(["B", "C"], i18n.t.bind(i18n), "vi")).toBe("B và C đang nhập…");
    expect(formatTypingLabel(["A", "B", "C"], i18n.t.bind(i18n), "vi")).toBe("A, B và C đang nhập…");
  });

  it("lists multiple names in English", async () => {
    await i18n.changeLanguage("en");
    expect(formatTypingLabel(["Alice", "Bob"], i18n.t.bind(i18n), "en")).toBe(
      "Alice and Bob are typing…",
    );
  });
});

afterAll(async () => {
  await i18n.changeLanguage("vi");
});

describe("formatSidebarTypingPreview nicknames", () => {
  it("prefers the reader's nickname for the typist", () => {
    expect(
      formatSidebarTypingPreview(["u7"], {
        isGroup: true,
        t: i18n.getFixedT("vi"),
        locale: "vi",
        contacts: [{ user_id: "u7", email: "", display_name: "Bảy" }],
        nicknamesByUserId: { U7: "Anh Bảy" },
      }),
    ).toBe("Anh Bảy đang nhập…");
  });
});

describe("typingNameByUserIdFromContext", () => {
  it("keys known human names by the normalized id and skips ids and blanks", () => {
    const id = "01M4WJJEDVW2TDT49SB7FYS7D1";
    expect(
      typingNameByUserIdFromContext([
        { user_id: "u1", display_name: " Lan " },
        { user_id: id, display_name: id },
        { user_id: " ", display_name: "Ghost" },
      ]),
    ).toEqual({ U1: "Lan" });
  });
});

describe("formatTypingLabel on Hermes (no Intl.ListFormat)", () => {
  it("falls back to a comma list", () => {
    const listFormat = Intl.ListFormat;
    Object.defineProperty(Intl, "ListFormat", { value: undefined, configurable: true });
    try {
      expect(formatTypingLabel(["A", "B"], i18n.getFixedT("vi"), "vi")).toBe("A, B đang nhập…");
    } finally {
      Object.defineProperty(Intl, "ListFormat", { value: listFormat, configurable: true });
    }
  });
});
