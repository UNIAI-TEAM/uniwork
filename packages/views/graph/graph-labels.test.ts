import { afterEach, describe, expect, it, vi } from "vitest";
import { formatGraphDate } from "./graph-labels";

describe("formatGraphDate", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("keeps the year of a calendar date in the next year east of UTC", () => {
    // Local midnight on 1 January is still 31 December in UTC here.
    vi.stubEnv("TZ", "Asia/Ho_Chi_Minh");
    vi.useFakeTimers({ now: new Date("2026-10-08T05:00:00Z") });
    expect(formatGraphDate("2027-01-01", "date", "en")).toBe("Jan 1, 2027");
    expect(formatGraphDate("2026-10-22", "date", "en")).toBe("Oct 22");
  });
});
