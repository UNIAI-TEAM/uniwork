import { afterEach, describe, expect, it } from "vitest";
import { dateTimeFormat, formatLocale, setDeviceClock } from "./locale-format";

const AT = new Date(2026, 9, 22, 14, 5).getTime();
const TIME = { hour: "2-digit", minute: "2-digit" } as const;

afterEach(() => setDeviceClock(null));

describe("locale-format", () => {
  it("writes in the app's language, English day first, anything else in Vietnamese", () => {
    expect(formatLocale("en")).toBe("en-GB");
    expect(formatLocale("vi")).toBe("vi-VN");
    expect(formatLocale("fr")).toBe("vi-VN");
    expect(formatLocale(undefined)).toBe("vi-VN");
    expect(dateTimeFormat("en", { day: "numeric", month: "long" }).format(AT)).toBe("22 October");
  });

  it("follows the device's 12- or 24-hour clock wherever the hour is shown", () => {
    setDeviceClock(true);
    expect(dateTimeFormat("en", TIME).format(AT)).toBe("14:05");
    setDeviceClock(false);
    expect(dateTimeFormat("en", TIME).format(AT)).toMatch(/^0?2:05\s?pm$/i);
    expect(dateTimeFormat("vi", { timeStyle: "short" }).format(AT)).toMatch(/2:05/);
    // A date alone has no clock to follow.
    expect(dateTimeFormat("vi", { weekday: "long" }).resolvedOptions().hour12).toBeUndefined();
  });

  it("keeps the language's own clock while the device's is unknown", () => {
    setDeviceClock(undefined);
    expect(dateTimeFormat("en", TIME).format(AT)).toBe("14:05");
    expect(dateTimeFormat("vi", TIME).format(AT)).toBe("14:05");
  });

  it("reuses a formatter, and starts over past its cap", () => {
    expect(dateTimeFormat("vi", TIME)).toBe(dateTimeFormat("vi", TIME));
    const first = dateTimeFormat("vi", { year: "numeric" });
    // Intl ignores a property it does not know; the cache keys on every one, so each is a new formatter.
    for (let shape = 0; shape < 70; shape += 1) dateTimeFormat("vi", { year: "numeric", [`shape${shape}`]: true } as Intl.DateTimeFormatOptions);
    expect(dateTimeFormat("vi", { year: "numeric" })).not.toBe(first);
  });
});
