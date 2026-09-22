import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { wrap } from "../test/api-mock";
import { CalendarPageView } from "./calendar-page";

initI18n();

const taskEvent: CalendarEvent = {
  id: "cal-task-1",
  kind: "task",
  entityId: "task-1",
  title: "Ship calendar",
  start: "2026-09-10",
  allDay: true,
};

const useCalendarEventsMock = vi.hoisted(() =>
  vi.fn(() => ({
    data: [taskEvent],
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  })),
);

vi.mock("@uniwork/core/calendar", () => ({
  useCalendarEvents: (...args: unknown[]) => useCalendarEventsMock(...args),
}));

const hostProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("./fullcalendar-host", () => ({
  FullCalendarHost: (props: Record<string, unknown>) => {
    hostProps.current = props;
    return <div data-testid="calendar-grid" />;
  },
}));

vi.mock("./calendar-mutations", () => ({
  useCalendarMutations: () => ({
    applyDropPatch: vi.fn(),
  }),
}));

describe("CalendarPageView", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the calendar title and month grid", () => {
    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    expect(screen.getByRole("heading", { name: "Lịch" })).toBeInTheDocument();
    expect(screen.getByTestId("calendar-grid")).toBeInTheDocument();
    expect(hostProps.current.onEventDropOrResize).toEqual(expect.any(Function));
  });

  it("updates the events query range when the toolbar changes month", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
    useCalendarEventsMock.mockClear();

    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    expect(useCalendarEventsMock).toHaveBeenCalledWith(
      "ws1",
      "2026-09-01",
      "2026-09-30",
      false,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kỳ trước" }));

    expect(useCalendarEventsMock).toHaveBeenLastCalledWith(
      "ws1",
      "2026-08-01",
      "2026-08-31",
      false,
    );
  });

  it("uses a single-day feed range when prev in day view", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
    useCalendarEventsMock.mockClear();

    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Ngày" }));
    useCalendarEventsMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Kỳ trước" }));

    expect(useCalendarEventsMock).toHaveBeenLastCalledWith(
      "ws1",
      "2026-09-14",
      "2026-09-14",
      false,
    );
  });
});
