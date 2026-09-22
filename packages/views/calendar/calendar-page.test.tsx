import { act, fireEvent, render, screen } from "@testing-library/react";
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
  useCalendarSidebar: () => ({
    data: {
      priorities: [],
      meetWith: [],
      assigned: [],
      todayOverdue: [],
      backlog: [],
    },
    isPending: false,
    isError: false,
  }),
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

vi.mock("./create-from-slot", () => ({
  CreateFromSlot: () => <div data-testid="create-from-slot" />,
}));

vi.mock("../meetings/new-meeting-dialog", () => ({
  NewMeetingDialog: () => null,
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
    expect(screen.getByLabelText("Bảng kế hoạch lịch")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-grid")).toBeInTheDocument();
    expect(hostProps.current.onEventDropOrResize).toEqual(expect.any(Function));
    expect(hostProps.current.onSlotSelect).toEqual(expect.any(Function));
    expect(screen.getByTestId("create-from-slot")).toBeInTheDocument();
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

    expect(useCalendarEventsMock).toHaveBeenLastCalledWith(
      "ws1",
      "2026-09-15",
      "2026-09-15",
      false,
    );

    useCalendarEventsMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Kỳ trước" }));

    expect(useCalendarEventsMock).toHaveBeenLastCalledWith(
      "ws1",
      "2026-09-14",
      "2026-09-14",
      false,
    );
  });

  it("does not re-render when datesSet reports the same feed range", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));

    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    const onDatesSet = hostProps.current.onDatesSet as (range: {
      from: string;
      to: string;
    }) => void;
    const callsAfterMount = useCalendarEventsMock.mock.calls.length;

    act(() => {
      onDatesSet({ from: "2026-09-01", to: "2026-09-30" });
      onDatesSet({ from: "2026-09-01", to: "2026-09-30" });
    });

    expect(useCalendarEventsMock.mock.calls.length).toBe(callsAfterMount);
  });
});
