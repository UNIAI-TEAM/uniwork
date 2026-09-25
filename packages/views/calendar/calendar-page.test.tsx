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

const meetingEvent: CalendarEvent = {
  id: "cal-meeting-1",
  kind: "meeting",
  entityId: "meeting-1",
  title: "Weekly sync",
  start: "2026-09-10T14:00:00Z",
  end: "2026-09-10T14:30:00Z",
  allDay: false,
};

const calendarEventsRefetch = vi.hoisted(() => vi.fn());
const useCalendarEventsMock = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => ({
    data: [taskEvent],
    isError: false,
    isPending: false,
    isRefetching: false,
    refetch: calendarEventsRefetch,
  })),
);

const calendarSidebarQuery = vi.hoisted(() => ({
  data: {
    priorities: [],
    meetWith: [],
    assigned: [],
    todayOverdue: [],
    backlog: [],
  },
  isPending: false,
  isError: false,
  isRefetching: false,
  refetch: vi.fn(),
}));

vi.mock("@uniwork/core/calendar", () => ({
  useCalendarEvents: useCalendarEventsMock,
  useCalendarSidebar: () => calendarSidebarQuery,
}));

const hostProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const createFromSlotProps = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

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
  CreateFromSlot: (props: Record<string, unknown>) => {
    createFromSlotProps.current = props;
    return <div data-testid="create-from-slot" />;
  },
}));

vi.mock("../meetings/new-meeting-dialog", () => ({
  NewMeetingDialog: () => null,
}));

vi.mock("../meetings/meeting-detail-view", () => ({
  MeetingDetailView: ({
    meetingId,
    headerActions,
    onJoin,
  }: {
    meetingId: string;
    headerActions?: React.ReactNode;
    onJoin: () => void;
  }) => (
    <div data-testid="meeting-detail-view">
      <span>{meetingId}</span>
      <button type="button" onClick={onJoin}>Join mocked meeting</button>
      {headerActions}
    </div>
  ),
}));

vi.mock("../tasks/detail", () => ({
  TaskDetailSuitePage: ({
    taskId,
    headerActions,
  }: {
    taskId: string;
    headerActions?: React.ReactNode;
  }) => (
    <div data-testid="task-detail-suite">
      <span>{taskId}</span>
      {headerActions}
    </div>
  ),
}));

describe("CalendarPageView", () => {
  afterEach(() => {
    vi.useRealTimers();
    calendarSidebarQuery.isError = false;
    calendarEventsRefetch.mockClear();
    calendarSidebarQuery.refetch.mockClear();
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
    expect(hostProps.current.language).toBe("vi");
    expect(hostProps.current.viewerTimeZone).toEqual(expect.any(String));
    expect(hostProps.current.showWeekends).toBe(true);
    expect(screen.getByTestId("create-from-slot")).toBeInTheDocument();
  });

  it("retries the sidebar query from its error state", () => {
    calendarSidebarQuery.isError = true;

    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(calendarSidebarQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes the events and sidebar queries together", () => {
    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Làm mới lịch" }));

    expect(calendarEventsRefetch).toHaveBeenCalledTimes(1);
    expect(calendarSidebarQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it("opens quick create without forcing a calendar slot", () => {
    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Tạo mục lịch" }));

    expect(createFromSlotProps.current.open).toBe(true);
    expect(createFromSlotProps.current.slot).toBeNull();
  });

  it("opens task creation directly with the selected calendar slot", () => {
    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );
    const slot = {
      start: new Date("2026-09-10T14:00:00"),
      end: new Date("2026-09-10T15:00:00"),
      allDay: false,
    };

    act(() => {
      const onSlotSelect = hostProps.current.onSlotSelect as (selected: typeof slot) => void;
      onSlotSelect(slot);
    });

    expect(createFromSlotProps.current.open).toBe(true);
    expect(createFromSlotProps.current.slot).toBe(slot);
  });

  it("keeps the calendar mounted while a clicked task opens in the detail panel", () => {
    const onOpenTask = vi.fn();
    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={onOpenTask}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    act(() => {
      const onEventClick = hostProps.current.onEventClick as (
        event: CalendarEvent,
      ) => void;
      onEventClick(taskEvent);
    });

    expect(screen.getByTestId("calendar-grid")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-suite")).toHaveTextContent("task-1");
    expect(onOpenTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mở toàn trang" }));
    expect(onOpenTask).toHaveBeenCalledWith("task-1");
  });

  it("keeps the calendar mounted while a clicked meeting opens in the detail panel", () => {
    const onOpenMeeting = vi.fn();
    const onJoinMeeting = vi.fn();
    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={onOpenMeeting}
          onJoinMeeting={onJoinMeeting}
        />,
      ),
    );

    act(() => {
      const onEventClick = hostProps.current.onEventClick as (
        event: CalendarEvent,
      ) => void;
      onEventClick(meetingEvent);
    });

    expect(screen.getByTestId("calendar-grid")).toBeInTheDocument();
    expect(screen.getByTestId("meeting-detail-view")).toHaveTextContent("meeting-1");
    expect(onOpenMeeting).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Join mocked meeting" }));
    expect(onJoinMeeting).toHaveBeenCalledWith("meeting-1");

    fireEvent.click(screen.getByRole("button", { name: "Mở cuộc họp toàn trang" }));
    expect(onOpenMeeting).toHaveBeenCalledWith("meeting-1");
  });

  it("restores focus after closing a meeting detail panel", () => {
    const source = document.createElement("button");
    source.textContent = "Meeting source";
    document.body.append(source);
    source.focus();
    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    act(() => {
      const onEventClick = hostProps.current.onEventClick as (
        event: CalendarEvent,
        trigger: HTMLElement,
      ) => void;
      onEventClick(meetingEvent, source);
    });
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));

    expect(screen.queryByTestId("meeting-detail-view")).not.toBeInTheDocument();
    expect(source).toHaveFocus();
    source.remove();
  });

  it("closes the task detail panel and restores focus to the source control", () => {
    const source = document.createElement("button");
    source.textContent = "Task source";
    document.body.append(source);
    source.focus();

    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    act(() => {
      const onEventClick = hostProps.current.onEventClick as (
        event: CalendarEvent,
      ) => void;
      onEventClick(taskEvent);
    });

    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));

    expect(screen.queryByTestId("task-detail-suite")).not.toBeInTheDocument();
    expect(source).toHaveFocus();
    source.remove();
  });

  it("passes the weekend visibility setting to the calendar grid", () => {
    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cài đặt lịch" }));
    fireEvent.click(screen.getByRole("switch", { name: "Hiện cuối tuần" }));

    expect(hostProps.current.showWeekends).toBe(false);
  });

  it("starts from URL preferences and reports preference changes", () => {
    const onPreferencesChange = vi.fn();
    useCalendarEventsMock.mockClear();

    render(
      wrap(
        <CalendarPageView
          workspaceId="ws1"
          initialPreferences={{
            viewMode: "week",
            mine: true,
            showWeekends: false,
          }}
          onPreferencesChange={onPreferencesChange}
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    expect(hostProps.current.viewMode).toBe("week");
    expect(hostProps.current.showWeekends).toBe(false);
    expect(useCalendarEventsMock).toHaveBeenLastCalledWith(
      "ws1",
      expect.any(String),
      expect.any(String),
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tháng" }));
    expect(onPreferencesChange).toHaveBeenLastCalledWith({
      viewMode: "month",
      mine: true,
      showWeekends: false,
    });
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
