import { describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { clock, clockRange, dayWord, durationWords, elapsedWords, longDay, overtimeWords, shortDay, untilWords } from "./format";

const ZONE = "Asia/Ho_Chi_Minh";
// The capture clock of the boards: Fri 23/10/2026 21:18 ICT.
const NOW = Date.parse("2026-10-23T14:18:00Z");
// The shared setup loads vi; load en too so one test can read both.
await setLocale("en");
await setLocale("vi");
const i18n = initI18n();
const t = i18n.getFixedT("vi");
const tEn = i18n.getFixedT("en");

describe("durationWords", () => {
  it("reads hours and minutes like the hero", () => {
    expect(durationWords(84, t)).toBe("1 giờ 24 phút");
    expect(durationWords(45, t)).toBe("45 phút");
    expect(durationWords(120, t)).toBe("2 giờ");
    expect(durationWords(0, t)).toBe("0 phút");
    expect(durationWords(-5, t)).toBe("0 phút");
  });
});

describe("untilWords", () => {
  it("counts minutes, then rounded hours, then calendar days", () => {
    expect(untilWords("2026-10-23T15:08:00Z", NOW, t, ZONE)).toBe("còn 50 phút");
    expect(untilWords("2026-10-24T07:00:00Z", NOW, t, ZONE)).toBe("còn 17 giờ");
    expect(untilWords("2026-10-29T02:00:00Z", NOW, t, ZONE)).toBe("còn 6 ngày");
    expect(untilWords("2026-10-29T02:00:00Z", NOW, tEn, ZONE)).toBe("6 days left");
  });

  it("is empty once the moment has passed or the stamp is bad", () => {
    expect(untilWords("2026-10-23T14:00:00Z", NOW, t, ZONE)).toBe("");
    expect(untilWords("nope", NOW, t, ZONE)).toBe("");
    expect(untilWords(undefined, NOW, t, ZONE)).toBe("");
  });
});

describe("elapsedWords / overtimeWords", () => {
  it("gives the live pill and the overtime meta line", () => {
    expect(elapsedWords("2026-10-23T13:54:00Z", NOW, t)).toBe("24 phút");
    expect(elapsedWords("2026-10-23T13:54:00Z", Date.parse("2026-10-23T15:18:00Z"), t, { held: true })).toBe(
      "đã họp 1 giờ 24 phút",
    );
    expect(overtimeWords("2026-10-23T15:08:00Z", Date.parse("2026-10-23T15:18:00Z"), t)).toBe("10 phút");
  });

  it("is empty before the end and for a bad stamp", () => {
    expect(overtimeWords("2026-10-23T15:08:00Z", NOW, t)).toBe("");
    expect(elapsedWords(null, NOW, t)).toBe("");
  });
});

describe("days and clocks", () => {
  it("writes the short and long day, with the year only when it is not this one", () => {
    expect(shortDay("2026-10-22T02:00:00Z", NOW, t, ZONE)).toBe("T5 22/10");
    expect(shortDay("2026-10-25T02:00:00Z", NOW, t, ZONE)).toBe("CN 25/10");
    expect(shortDay("2026-10-26T02:00:00Z", NOW, tEn, ZONE)).toBe("Mon 26/10");
    expect(longDay("2026-10-22T02:00:00Z", NOW, t, ZONE)).toBe("Thứ Năm 22/10");
    expect(longDay("2025-10-22T02:00:00Z", NOW, t, ZONE)).toBe("Thứ Tư 22/10/2025");
    expect(shortDay("bad", NOW, t, ZONE)).toBe("");
  });

  it("names today, yesterday and tomorrow in the zone, nothing else", () => {
    expect(dayWord("2026-10-22T08:00:00Z", NOW, t, ZONE)).toBe("hôm qua");
    expect(dayWord("2026-10-23T16:30:00Z", NOW, t, ZONE)).toBe("hôm nay"); // 23:30 ICT, still the 23rd
    expect(dayWord("2026-10-24T07:00:00Z", NOW, t, ZONE)).toBe("ngày mai");
    expect(dayWord("2026-10-23T01:00:00Z", NOW, t, ZONE)).toBe("hôm nay");
    expect(dayWord("2026-10-28T03:00:00Z", NOW, t, ZONE)).toBeNull();
  });

  it("prints 24-hour clocks and the kit's range", () => {
    expect(clock("2026-10-22T02:06:00Z", ZONE)).toBe("09:06");
    expect(clockRange("2026-10-23T13:54:00Z", "2026-10-23T15:08:00Z", ZONE)).toBe("20:54–22:08");
    expect(clock("x", ZONE)).toBe("");
    expect(clockRange("x", "2026-10-23T15:08:00Z", ZONE)).toBe("");
  });
});
