import { renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { useMeetingScheduleDeadline } from "./use-meeting-schedule-deadline";

const toast = vi.hoisted(() => ({
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

beforeAll(() => {
  initI18n();
});

describe("useMeetingScheduleDeadline", () => {
  it("does not leave when scheduled time elapses; announces overtime instead", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T10:00:01.000Z"));
    toast.info.mockClear();
    const onLeave = vi.fn();
    renderHook(() =>
      useMeetingScheduleDeadline({
        endsAt: "2026-09-03T10:00:00.000Z",
        status: "IN_PROGRESS",
        admitted: true,
        onLeave,
      }),
    );
    expect(onLeave).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("leaves only after the meeting is actually ended", () => {
    const onLeave = vi.fn();
    renderHook(() =>
      useMeetingScheduleDeadline({
        endsAt: "2026-09-03T10:00:00.000Z",
        status: "ENDED",
        admitted: true,
        onLeave,
      }),
    );
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
