import { describe, expect, it } from "vitest";
import { emailHubLocale, formatBytes, formatEmailListDate, senderInitial } from "./email-hub-format";

describe("senderInitial", () => {
  it("takes the first letter of a Vietnamese name, diacritics included", () => {
    expect(senderInitial("Đỗ Thị Hà", "ha@example.com")).toBe("Đ");
    expect(senderInitial("ánh", undefined)).toBe("Á");
  });

  it("falls back to the address, then to a question mark", () => {
    expect(senderInitial("", "minh@example.com")).toBe("M");
    expect(senderInitial("  ", "")).toBe("?");
  });
});

describe("formatEmailListDate", () => {
  const now = new Date(2026, 8, 24, 18, 30);

  it("shows only the time for today's mail", () => {
    const text = formatEmailListDate(new Date(2026, 8, 24, 9, 5).toISOString(), "vi-VN", now);
    expect(text).toMatch(/09:05/);
    expect(text).not.toMatch(/2026/);
  });

  it("drops the year inside the current year and keeps it before", () => {
    expect(formatEmailListDate(new Date(2026, 1, 3).toISOString(), "vi-VN", now)).not.toMatch(/2026/);
    expect(formatEmailListDate(new Date(2025, 11, 30).toISOString(), "vi-VN", now)).toMatch(/2025/);
  });

  it("returns an empty string for an unparseable date", () => {
    expect(formatEmailListDate("nope", "vi-VN", now)).toBe("");
  });
});

describe("emailHubLocale", () => {
  it("follows the app language, Vietnamese by default", () => {
    expect(emailHubLocale("en")).toBe("en-US");
    expect(emailHubLocale("vi")).toBe("vi-VN");
    expect(emailHubLocale(undefined)).toBe("vi-VN");
  });
});

describe("formatBytes", () => {
  it("uses the app language's decimal separator", () => {
    expect(formatBytes(482_133, "vi-VN")).toBe("470,8 KB");
    expect(formatBytes(482_133, "en-US")).toBe("470.8 KB");
    expect(formatBytes(900, "vi-VN")).toBe("900 B");
    expect(formatBytes(3 * 1024 * 1024, "vi-VN")).toBe("3 MB");
  });
});
