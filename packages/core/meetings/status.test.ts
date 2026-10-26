import { describe, expect, it } from "vitest";
import { activityLabelKey } from "./status";

describe("activityLabelKey", () => {
  it("names the AI summary row instead of the generic label", () => {
    expect(activityLabelKey("SUMMARY_CREATED")).toBe("meetings.activity_summary_created");
  });
});
