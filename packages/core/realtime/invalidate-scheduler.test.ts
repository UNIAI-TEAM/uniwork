import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { meetingKeys } from "../meetings/hooks";
import { createInvalidateScheduler, shouldInvalidateMeetingDetail } from "./invalidate-scheduler";

describe("shouldInvalidateMeetingDetail", () => {
  it("skips when cached version is already current", () => {
    const qc = new QueryClient();
    qc.setQueryData(meetingKeys.detail("m1"), { id: "m1", version: 5 });
    expect(shouldInvalidateMeetingDetail(qc, "m1", "5")).toBe(false);
    expect(shouldInvalidateMeetingDetail(qc, "m1", "4")).toBe(false);
    expect(shouldInvalidateMeetingDetail(qc, "m1", "6")).toBe(true);
  });
});

describe("createInvalidateScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces multiple schedules into one invalidation", () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const scheduler = createInvalidateScheduler(qc);
    scheduler.schedule(["meetings", "w1"]);
    scheduler.schedule(["meeting", "m1"]);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(invalidate).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });
});
