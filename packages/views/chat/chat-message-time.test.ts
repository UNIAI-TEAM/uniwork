import { describe, expect, it } from "vitest";
import { formatMessageDay, formatMessageTime, messageDayKey } from "./chat-message-time";

const labels = { today: "Hôm nay", yesterday: "Hôm qua" };
const now = new Date(2026, 8, 21, 15, 0);

describe("formatMessageDay", () => {
  it("names today and yesterday", () => {
    expect(formatMessageDay(new Date(2026, 8, 21, 8, 0).getTime(), "vi", labels, now)).toBe("Hôm nay");
    expect(formatMessageDay(new Date(2026, 8, 20, 23, 59).getTime(), "vi", labels, now)).toBe("Hôm qua");
  });

  it("uses the weekday within a week and the date beyond it", () => {
    const threeDays = formatMessageDay(new Date(2026, 8, 18, 9, 0).getTime(), "en", labels, now);
    expect(threeDays).toBe("Friday");
    const older = formatMessageDay(new Date(2026, 7, 2, 9, 0).getTime(), "en", labels, now);
    expect(older).toBe("August 2");
  });

  it("adds the year only for another year", () => {
    expect(formatMessageDay(new Date(2025, 11, 31, 9, 0).getTime(), "en", labels, now)).toBe("December 31, 2025");
  });
});

describe("messageDayKey", () => {
  it("is equal within one local day and differs across midnight", () => {
    const a = messageDayKey(new Date(2026, 8, 21, 0, 1).getTime());
    const b = messageDayKey(new Date(2026, 8, 21, 23, 59).getTime());
    const c = messageDayKey(new Date(2026, 8, 22, 0, 0).getTime());
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

describe("formatMessageTime", () => {
  it("prints hours and minutes", () => {
    expect(formatMessageTime(new Date(2026, 8, 21, 9, 5).getTime(), "vi")).toMatch(/09:05/);
  });
});
