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
    const onClosed = vi.fn();
    renderHook(() =>
      useMeetingScheduleDeadline({
        endsAt: "2026-09-03T10:00:00.000Z",
        status: "IN_PROGRESS",
        admitted: true,
        onClosed,
      }),
    );
    expect(onClosed).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("closes the room with a reason, not a silent leave, once the meeting has ended", () => {
    const onClosed = vi.fn();
    renderHook(() =>
      useMeetingScheduleDeadline({
        endsAt: "2026-09-03T10:00:00.000Z",
        status: "ENDED",
        admitted: true,
        onClosed,
      }),
    );
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledWith("ended");
  });

  it("closes a canceled meeting even without a scheduled end", () => {
    const onClosed = vi.fn();
    renderHook(() => useMeetingScheduleDeadline({ status: "CANCELED", admitted: true, onClosed }));
    expect(onClosed).toHaveBeenCalledWith("canceled");
  });

  it("does nothing before the viewer is admitted", () => {
    const onClosed = vi.fn();
    renderHook(() => useMeetingScheduleDeadline({ status: "ENDED", admitted: false, onClosed }));
    expect(onClosed).not.toHaveBeenCalled();
  });
});
