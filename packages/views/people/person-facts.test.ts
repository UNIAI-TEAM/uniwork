import { describe, expect, it } from "vitest";
import { formatJoinedOn, formatTimezone } from "./person-facts";

describe("formatJoinedOn", () => {
  it("reads a stored date in the reader's language", () => {
    expect(formatJoinedOn("2024-03-18", "vi")).toBe("18 tháng 3, 2024");
    expect(formatJoinedOn("2024-03-18", "en")).toBe("18 March 2024");
  });

  it("keeps the calendar day whatever the reader's offset is", () => {
    // `new Date("2024-01-01")` is UTC midnight, which is 31 December west of
    // Greenwich. The date is built from parts so it cannot slip a day.
    expect(formatJoinedOn("2024-01-01", "en")).toContain("1 January");
  });

  it("hands back anything that is not a stored date", () => {
    expect(formatJoinedOn("", "vi")).toBe("");
    expect(formatJoinedOn("hôm qua", "vi")).toBe("hôm qua");
    expect(formatJoinedOn("2024-13-45", "vi")).toBe("2024-13-45");
  });
});

describe("formatTimezone", () => {
  it("leads with the offset, which is the fact a colleague acts on", () => {
    expect(formatTimezone("Asia/Ho_Chi_Minh", "vi")).toBe("GMT+7 · Giờ Đông Dương");
    expect(formatTimezone("Asia/Ho_Chi_Minh", "en")).toBe("GMT+7 · Indochina Time");
  });

  it("says the offset once when the zone has no separate name", () => {
    expect(formatTimezone("UTC", "en")).toBe("GMT+0 · Coordinated Universal Time");
  });

  it("falls back to the city for an id the browser does not know", () => {
    expect(formatTimezone("Khong/Ton_Tai", "vi")).toBe("Ton Tai");
  });

  it("stays empty when there is nothing to say", () => {
    expect(formatTimezone("", "vi")).toBe("");
  });
});
