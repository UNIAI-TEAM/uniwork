import { describe, expect, it } from "vitest";
import { foldSearchText, matchesTimezone, timezoneItems } from "./timezone-options";

function find(value: string, locale = "en") {
  return timezoneItems("Asia/Ho_Chi_Minh", locale).find((z) => z.value === value)!;
}

describe("timezoneItems", () => {
  it("labels each zone with its UTC offset, the place, and the zone's name in the reader's language", () => {
    expect(find("Asia/Ho_Chi_Minh").label).toBe("(UTC+07:00) Ho Chi Minh · Indochina Time");
    expect(find("Asia/Ho_Chi_Minh", "vi").label).toBe("(UTC+07:00) Hồ Chí Minh · Giờ Đông Dương");
    expect(find("Asia/Tokyo", "vi").label).toBe("(UTC+09:00) Tokyo · Giờ Chuẩn Nhật Bản");
    expect(timezoneItems("Asia/Ho_Chi_Minh").find((z) => z.offsetMinutes === 330)?.label).toMatch(/^\(UTC\+05:30\) /);
  });

  it("keeps only the place when the engine has no name for the zone", () => {
    expect(timezoneItems("UTC").find((z) => z.value === "UTC")?.label).toBe("(UTC+00:00) UTC");
  });

  it("sorts by offset, west to east, listing Vietnam once under its current id", () => {
    const items = timezoneItems("Asia/Ho_Chi_Minh");
    const offsets = items.map((z) => z.offsetMinutes);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(items.filter((z) => z.value === "Asia/Ho_Chi_Minh")).toHaveLength(1);
    expect(items.some((z) => z.value === "Asia/Saigon")).toBe(false);
  });

  it("keeps a stored zone the engine does not list, in its offset's place", () => {
    const items = timezoneItems("America/Buenos_Aires");
    expect(items.filter((z) => z.value === "America/Buenos_Aires")).toHaveLength(1);
  });

  it("builds the list once per locale", () => {
    expect(timezoneItems("Asia/Bangkok")).toBe(timezoneItems("Asia/Tokyo"));
    expect(timezoneItems("Asia/Bangkok", "vi")).not.toBe(timezoneItems("Asia/Bangkok", "en"));
  });
});

describe("matchesTimezone", () => {
  it("ignores case and Vietnamese marks, and finds Vietnam by its cities", () => {
    expect(foldSearchText("Hà Nội")).toBe("ha noi");
    const vn = find("Asia/Ho_Chi_Minh", "vi");
    for (const q of ["Hà Nội", "ha noi", "Hanoi", "sai gon", "ho chi minh", "Asia/Ho_Chi_Minh", "đông dương", "utc+7", "GMT+7"]) {
      expect(matchesTimezone(vn, q), q).toBe(true);
    }
    expect(matchesTimezone(find("Asia/Tokyo", "vi"), "ha noi")).toBe(false);
  });

  it("matches the English zone name and the IANA region", () => {
    const tokyo = find("Asia/Tokyo");
    expect(matchesTimezone(tokyo, "japan")).toBe(true);
    expect(matchesTimezone(tokyo, "asia tokyo")).toBe(true);
  });
});
