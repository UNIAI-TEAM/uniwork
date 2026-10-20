import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import vi from "@uniwork/core/i18n/locales/vi.json";
import { EMPTY_CELL, formatBytes, formatListDate } from "./format";

// The shared list formats (contract UNI-2045, "Quy tắc định dạng dùng chung").
// Dates are local time, 24h in both languages; `now` is injected so the day
// boundaries are tested without a clock.

const NOW = new Date(2026, 9, 21, 9, 5); // 21 Oct 2026, 09:05 local
const iso = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe("formatListDate", () => {
  it("names today by its clock, 24h, in both languages", () => {
    const at = iso(2026, 10, 21, 23, 41);
    expect(formatListDate(at, NOW, "vi")).toBe("23:41");
    expect(formatListDate(at, NOW, "en")).toBe("23:41");
    expect(formatListDate(iso(2026, 10, 21, 0, 7), NOW, "en")).toBe("00:07");
  });

  it("names yesterday with its clock", () => {
    const at = iso(2026, 10, 20, 16, 30);
    expect(formatListDate(at, NOW, "vi")).toBe("Hôm qua, 16:30");
    expect(formatListDate(at, NOW, "en")).toBe("Yesterday, 16:30");
  });

  it("reads yesterday across a month and a year boundary", () => {
    expect(formatListDate(iso(2026, 9, 30, 8, 0), new Date(2026, 9, 1, 0, 30), "vi")).toBe("Hôm qua, 08:00");
    expect(formatListDate(iso(2025, 12, 31, 22, 15), new Date(2026, 0, 1, 7, 0), "en")).toBe("Yesterday, 22:15");
  });

  it("writes the day and month in the same year", () => {
    const at = iso(2026, 10, 18, 12, 0);
    expect(formatListDate(at, NOW, "vi")).toBe("18/10");
    expect(formatListDate(at, NOW, "en")).toBe("Oct 18");
    expect(formatListDate(iso(2026, 1, 3, 12, 0), NOW, "vi")).toBe("03/01");
  });

  it("adds the year in another year", () => {
    const at = iso(2025, 10, 18, 12, 0);
    expect(formatListDate(at, NOW, "vi")).toBe("18/10/2025");
    expect(formatListDate(at, NOW, "en")).toBe("Oct 18, 2025");
  });

  it("treats a regional vi tag like vi and any other tag like en", () => {
    expect(formatListDate(iso(2026, 10, 18, 12, 0), NOW, "vi-VN")).toBe("18/10");
    expect(formatListDate(iso(2026, 10, 18, 12, 0), NOW, "en-US")).toBe("Oct 18");
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(formatListDate(new Date(2026, 9, 18, 12, 0), NOW, "vi")).toBe("18/10");
  });

  it("answers the dash for an empty or invalid date", () => {
    for (const bad of [null, undefined, "", "not a date", new Date(Number.NaN)]) {
      expect(formatListDate(bad, NOW, "vi")).toBe("—");
      expect(formatListDate(bad, NOW, "en")).toBe("—");
    }
    expect(EMPTY_CELL).toBe("—");
  });

  it("takes the word for yesterday from the caller when it has one", () => {
    expect(formatListDate(iso(2026, 10, 20, 16, 30), NOW, "vi", { yesterday: "Hôm qua!" })).toBe("Hôm qua!, 16:30");
  });

  it("keeps the built-in yesterday words equal to the locale files", () => {
    expect(formatListDate(iso(2026, 10, 20, 1, 0), NOW, "vi")).toBe(`${vi.documents.list.date.yesterday}, 01:00`);
    expect(formatListDate(iso(2026, 10, 20, 1, 0), NOW, "en")).toBe(`${en.documents.list.date.yesterday}, 01:00`);
  });
});

describe("formatBytes", () => {
  it("writes bytes whole and larger units to one decimal under 10", () => {
    expect(formatBytes(23, "vi")).toBe("23 B");
    expect(formatBytes(2970, "vi")).toBe("2,9 KB");
    expect(formatBytes(2970, "en")).toBe("2.9 KB");
    expect(formatBytes(Math.round(4.8 * 1024 * 1024), "vi")).toBe("4,8 MB");
    expect(formatBytes(Math.round(4.8 * 1024 * 1024), "en")).toBe("4.8 MB");
  });

  it("drops the decimal from 10 units up", () => {
    expect(formatBytes(318 * 1024, "en")).toBe("318 KB");
    expect(formatBytes(12 * 1024 * 1024 + 700_000, "vi")).toBe("13 MB");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024, "en")).toBe("1.5 GB");
  });

  it("moves up a unit at 1024", () => {
    expect(formatBytes(1023, "en")).toBe("1,023 B");
    expect(formatBytes(1024, "en")).toBe("1 KB");
  });

  it("answers the dash where there is no file size to show", () => {
    for (const none of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatBytes(none, "vi")).toBe("—");
    }
  });
});
