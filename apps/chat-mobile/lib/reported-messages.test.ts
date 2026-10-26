import { describe, expect, it } from "vitest";
import { REPORTED_MESSAGES_MAX, readReportedMessages, rememberReported } from "./reported-messages";

describe("reported messages", () => {
  it("reads back only message ids with a finite time", () => {
    expect(readReportedMessages({ m1: 10, m2: "x", "": 3, m3: Number.NaN, m4: 20 })).toEqual({ m1: 10, m4: 20 });
    expect(readReportedMessages(null)).toEqual({});
    expect(readReportedMessages([1, 2])).toEqual({});
    expect(readReportedMessages("m1")).toEqual({});
  });

  it("remembers a report, keeping the newest when there are too many", () => {
    expect(rememberReported({ m1: 1 }, "m2", 2)).toEqual({ m1: 1, m2: 2 });
    const full = Object.fromEntries(Array.from({ length: REPORTED_MESSAGES_MAX }, (_, i) => [`m${i}`, i]));
    const next = rememberReported(full, "new", 10_000);
    expect(Object.keys(next)).toHaveLength(REPORTED_MESSAGES_MAX);
    expect(next.new).toBe(10_000);
    expect(next.m0).toBeUndefined();
    expect(Object.keys(readReportedMessages({ ...full, extra: -1 }))).toHaveLength(REPORTED_MESSAGES_MAX);
  });
});
