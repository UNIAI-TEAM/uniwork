import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphHistoryItem } from "@uniwork/core/types/graph";
import { formatGraphDate, historyWhen } from "./graph-labels";

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

  it("prints a timed due's hour and minute in the viewer's zone", () => {
    // A due_at fallback (no due_date) is an instant: two on the same day must
    // not both read "15 thg 10".
    vi.stubEnv("TZ", "Asia/Ho_Chi_Minh");
    vi.useFakeTimers({ now: new Date("2026-10-08T05:00:00Z") });
    expect(formatGraphDate("2026-10-15T04:00:00Z", "datetime", "en")).toBe("Oct 15, 11:00");
    expect(formatGraphDate("2026-10-15T02:05:00Z", "datetime", "vi")).toBe("09:05 15 thg 10");
    expect(formatGraphDate("2027-01-01T01:30:00Z", "datetime", "en")).toBe("Jan 1, 2027, 08:30");
  });
});

describe("historyWhen", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("dates a row by its day, without the time", () => {
    vi.stubEnv("TZ", "Asia/Ho_Chi_Minh");
    vi.useFakeTimers({ now: new Date("2026-10-08T05:00:00Z") });
    const item: GraphHistoryItem = {
      kind: "edge", edge_type: "OWNED_BY", fact_type: "", direction: "out", origin: "SYSTEM",
      valid_from: "2026-10-03T02:00:00Z", valid_to: "2026-10-05T02:00:00Z",
      value: "", previous: "", precision: "", previous_precision: "", backfilled: false,
    };
    const label = (key: string, vars?: Record<string, string>) => `${key} ${JSON.stringify(vars ?? {})}`;
    expect(historyWhen(item, label, "en")).toBe('graph.history.range {"from":"Oct 3","to":"Oct 5"}');
  });
});
