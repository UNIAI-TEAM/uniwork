import { describe, expect, it } from "vitest";
import { timezoneItems } from "./timezone-options";

describe("timezoneItems", () => {
  it("labels each zone with its UTC offset and a readable place name", () => {
    const items = timezoneItems("Asia/Ho_Chi_Minh");
    expect(items.find((z) => z.value === "Asia/Ho_Chi_Minh")?.label).toBe("(UTC+07:00) Asia/Ho Chi Minh");
    expect(items.find((z) => z.value === "Asia/Bangkok")?.label).toBe("(UTC+07:00) Asia/Bangkok");
    expect(items.find((z) => z.offsetMinutes === 330)?.label).toMatch(/^\(UTC\+05:30\) /);
  });

  it("sorts by offset, west to east, with a stored zone the engine does not list in its place", () => {
    const items = timezoneItems("Asia/Ho_Chi_Minh");
    const offsets = items.map((z) => z.offsetMinutes);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(items.filter((z) => z.value === "Asia/Ho_Chi_Minh")).toHaveLength(1);
  });

  it("builds the list once", () => {
    expect(timezoneItems("Asia/Bangkok")).toBe(timezoneItems("Asia/Tokyo"));
  });
});
