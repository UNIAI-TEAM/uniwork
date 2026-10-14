import { describe, expect, it, vi } from "vitest";
import { emailHubLocale, formatBytes, formatEmailListDate, senderInitial } from "./email-hub-format";

function legacyListDate(iso: string, locale: string, now: Date): string {
  const date = new Date(iso);
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function legacyFullDate(iso: string, locale: string): string {
  const date = new Date(iso);
  const datePart = date.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

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

describe("email date formatter cache", () => {
  it("keeps vi/en output and constructs each locale/options formatter only once", async () => {
    vi.resetModules();
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    const constructor = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function DateTimeFormat(locale, options) {
      return new NativeDateTimeFormat(locale, options);
    });

    try {
      const { formatEmailFullDate, formatEmailListDate: formatListDate } = await import("./email-hub-format");
      const now = new Date(2026, 8, 24, 18, 30);
      const today = new Date(2026, 8, 24, 9, 5).toISOString();
      const thisYear = new Date(2026, 1, 3, 9, 5).toISOString();
      const older = new Date(2025, 11, 30, 9, 5).toISOString();

      for (const locale of ["vi-VN", "en-US"]) {
        for (const iso of [today, thisYear, older]) {
          const first = formatListDate(iso, locale, now);
          expect(formatListDate(iso, locale, now)).toBe(first);
          expect(first).toBe(legacyListDate(iso, locale, now));
        }

        const first = formatEmailFullDate(today, locale);
        expect(formatEmailFullDate(today, locale)).toBe(first);
        expect(first).toBe(legacyFullDate(today, locale));
      }

      expect(constructor).toHaveBeenCalledTimes(10);
    } finally {
      constructor.mockRestore();
    }
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
