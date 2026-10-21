import { describe, expect, it } from "vitest";
import { FOLLOW_UP_HOURS, followUpDueAt } from "./follow-ups";

describe("followUpDueAt", () => {
  it("is FOLLOW_UP_HOURS after the moment the follow-up is made", () => {
    expect(FOLLOW_UP_HOURS).toBe(2);
    expect(followUpDueAt(Date.UTC(2026, 9, 21, 8, 30))).toBe("2026-10-21T10:30:00.000Z");
  });
});
