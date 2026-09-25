import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@uniwork/core/calendar/types";
import { FullCalendarHost } from "./fullcalendar-host";

type DropResizeArg = {
  event: {
    id: string;
    start: Date | null;
    end: Date | null;
    allDay: boolean;
  };
  revert: () => void;
};

type CapturedFcProps = {
  initialView?: string;
  hiddenDays?: number[];
  firstDay?: number;
  locale?: { code?: string };
  timeZone?: string;
  nowIndicator?: boolean;
  slotMinTime?: string;
  slotMaxTime?: string;
  scrollTime?: string;
  dayMaxEventRows?: boolean | number;
  allDayText?: string;
  editable?: boolean;
  selectable?: boolean;
  selectMirror?: boolean;
  height?: string | number;
  datesSet?: (arg: { start: Date; end: Date }) => void;
  eventClick?: (arg: { event: { id: string } }) => void;
  eventDrop?: (arg: DropResizeArg) => void | Promise<void>;
  eventResize?: (arg: DropResizeArg) => void | Promise<void>;
  dateClick?: (arg: { date: Date; allDay: boolean }) => void;
  select?: (arg: { start: Date; end: Date; allDay: boolean }) => void;
  droppable?: boolean;
  eventReceive?: (arg: {
    event: { start: Date | null; extendedProps: Record<string, unknown> };
    revert: () => void;
  }) => void | Promise<void>;
};

let captured: CapturedFcProps = {};

vi.mock("@fullcalendar/react", () => ({
  default: (props: CapturedFcProps) => {
    captured = props;
    return <div data-testid="fc-inner" />;
  },
}));

vi.mock("@fullcalendar/daygrid", () => ({
  default: {},
}));

vi.mock("@fullcalendar/timegrid", () => ({
  default: {},
}));

vi.mock("@fullcalendar/interaction", () => ({
  default: {},
}));

const sample: CalendarEvent = {
  id: "ev-1",
  kind: "task",
  entityId: "task-1",
  title: "Demo",
  start: "2026-09-10",
  allDay: true,
};

describe("FullCalendarHost", () => {
  it("renders the grid wrapper and forwards datesSet as inclusive YYYY-MM-DD", () => {
    const onDatesSet = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={onDatesSet}
        onEventClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("calendar-grid")).toBeInTheDocument();
    captured.datesSet?.({
      start: new Date("2026-09-01T00:00:00"),
      end: new Date("2026-09-30T00:00:00"),
    });
    expect(onDatesSet).toHaveBeenCalledWith({ from: "2026-09-01", to: "2026-09-29" });
  });

  it("localizes the work-week grid and shows the viewer time zone", () => {
    const onDatesSet = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="work_week"
        language="vi"
        viewerTimeZone="Asia/Ho_Chi_Minh"
        onDatesSet={onDatesSet}
        onEventClick={vi.fn()}
      />,
    );
    expect(captured.initialView).toBe("timeGridWeek");
    expect(captured.hiddenDays).toEqual([0, 6]);
    expect(captured.firstDay).toBe(1);
    expect(captured.locale?.code).toBe("vi");
    expect(captured.timeZone).toBe("local");
    expect(captured.nowIndicator).toBe(true);
    expect(screen.getByText("GMT+7")).toHaveAttribute("title", "Asia/Ho_Chi_Minh");

    captured.datesSet?.({
      start: new Date("2026-09-14T00:00:00"),
      end: new Date("2026-09-21T00:00:00"),
    });
    expect(onDatesSet).toHaveBeenCalledWith({ from: "2026-09-14", to: "2026-09-18" });
  });

  it("does not show a time-zone axis label or now indicator in month view", () => {
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        language="en"
        viewerTimeZone="Asia/Ho_Chi_Minh"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );
    expect(captured.locale?.code).toBe("en-gb");
    expect(captured.nowIndicator).toBe(false);
    expect(screen.queryByText("GMT+7")).not.toBeInTheDocument();
  });

  it("hides weekends in week and month views when configured", () => {
    const { rerender } = render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="week"
        showWeekends={false}
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );
    expect(captured.hiddenDays).toEqual([0, 6]);

    rerender(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="day"
        showWeekends={false}
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );
    expect(captured.hiddenDays).toEqual([]);
  });

  it("collapses and expands all-day events in time-grid views", () => {
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="week"
        language="vi"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );

    const expand = screen.getByRole("button", {
      name: "Mở rộng sự kiện cả ngày",
    });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(captured.dayMaxEventRows).toBe(1);
    expect(captured.allDayText).toBe("");

    fireEvent.click(expand);

    expect(
      screen.getByRole("button", { name: "Thu gọn sự kiện cả ngày" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(captured.dayMaxEventRows).toBe(false);
  });

  it("fills the host height so time grids scroll internally", () => {
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="day"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );
    expect(captured.height).toBe("100%");
  });

  it("opens time-grid views at midnight with the full 24-hour range", () => {
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="week"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );

    expect(captured.slotMinTime).toBe("00:00:00");
    expect(captured.slotMaxTime).toBe("24:00:00");
    expect(captured.scrollTime).toBe("00:00:00");
  });

  it("resolves eventClick by id", () => {
    const onEventClick = vi.fn();
    const source = document.createElement("a");
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={onEventClick}
      />,
    );
    captured.eventClick?.({ event: { id: "ev-1" }, el: source });
    expect(onEventClick).toHaveBeenCalledWith(sample, source);
  });

  it("defaults editable to true on FullCalendar", () => {
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );
    expect(captured.editable).toBe(true);
  });

  it("eventDrop calls onEventDropOrResize with task due patch", async () => {
    const onEventDropOrResize = vi.fn().mockResolvedValue(undefined);
    const revert = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
        onEventDropOrResize={onEventDropOrResize}
      />,
    );
    await captured.eventDrop?.({
      event: {
        id: "ev-1",
        start: new Date("2026-09-11T00:00:00.000Z"),
        end: new Date("2026-09-12T00:00:00.000Z"),
        allDay: true,
      },
      revert,
    });
    expect(onEventDropOrResize).toHaveBeenCalledWith({
      kind: "task",
      entityId: "task-1",
      patch: { due_date: "2026-09-11" },
    });
    expect(revert).not.toHaveBeenCalled();
  });

  it("eventDrop calls onEventDropOrResize with meeting timed patch", async () => {
    const meeting: CalendarEvent = {
      id: "ev-m1",
      kind: "meeting",
      entityId: "m1",
      title: "Sync",
      start: "2026-09-10T09:00:00.000Z",
      end: "2026-09-10T10:00:00.000Z",
      allDay: false,
    };
    const onEventDropOrResize = vi.fn().mockResolvedValue(undefined);
    const revert = vi.fn();
    render(
      <FullCalendarHost
        events={[meeting]}
        initialDate="2026-09-01"
        viewMode="day"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
        onEventDropOrResize={onEventDropOrResize}
      />,
    );
    const newStart = new Date("2026-09-10T14:00:00.000Z");
    const newEnd = new Date("2026-09-10T15:00:00.000Z");
    await captured.eventDrop?.({
      event: {
        id: "ev-m1",
        start: newStart,
        end: newEnd,
        allDay: false,
      },
      revert,
    });
    expect(onEventDropOrResize).toHaveBeenCalledWith({
      kind: "meeting",
      entityId: "m1",
      body: { starts_at: newStart.toISOString(), ends_at: newEnd.toISOString() },
    });
    expect(revert).not.toHaveBeenCalled();
  });

  it("eventDrop updates a timed task instead of reverting", async () => {
    const onEventDropOrResize = vi.fn();
    const revert = vi.fn();
    const timedTask: CalendarEvent = {
      ...sample,
      start: "2026-09-10T07:00:00.000Z",
      end: "2026-09-10T08:00:00.000Z",
      allDay: false,
    };
    render(
      <FullCalendarHost
        events={[timedTask]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
        onEventDropOrResize={onEventDropOrResize}
      />,
    );
    await captured.eventDrop?.({
      event: {
        id: "ev-1",
        start: new Date("2026-09-11T12:00:00.000Z"),
        end: new Date("2026-09-11T13:00:00.000Z"),
        allDay: false,
      },
      revert,
    });
    expect(onEventDropOrResize).toHaveBeenCalledWith({
      kind: "task",
      entityId: "task-1",
      patch: {
        start_date: "2026-09-11",
        due_date: "2026-09-11",
        start_at: "2026-09-11T12:00:00.000Z",
        due_at: "2026-09-11T13:00:00.000Z",
      },
    });
    expect(revert).not.toHaveBeenCalled();
  });

  it("eventResize updates a timed task duration instead of reverting", async () => {
    const onEventDropOrResize = vi.fn();
    const revert = vi.fn();
    const timedTask: CalendarEvent = {
      ...sample,
      start: "2026-09-10T07:00:00.000Z",
      end: "2026-09-10T08:00:00.000Z",
      allDay: false,
    };
    render(
      <FullCalendarHost
        events={[timedTask]}
        initialDate="2026-09-01"
        viewMode="week"
        onDatesSet={vi.fn()}
        onSlotSelect={vi.fn()}
        onEventClick={vi.fn()}
        onEventDropOrResize={onEventDropOrResize}
      />,
    );

    await captured.eventResize?.({
      event: {
        id: "ev-1",
        start: new Date("2026-09-10T07:00:00.000Z"),
        end: new Date("2026-09-10T09:30:00.000Z"),
        allDay: false,
      },
      revert,
    });

    expect(onEventDropOrResize).toHaveBeenCalledWith({
      kind: "task",
      entityId: "task-1",
      patch: {
        start_date: "2026-09-10",
        due_date: "2026-09-10",
        start_at: "2026-09-10T07:00:00.000Z",
        due_at: "2026-09-10T09:30:00.000Z",
      },
    });
    expect(revert).not.toHaveBeenCalled();
  });

  it("enables selectable and forwards dateClick to onSlotSelect", () => {
    const onSlotSelect = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
        onSlotSelect={onSlotSelect}
      />,
    );
    expect(captured.selectable).toBe(true);
    expect(captured.selectMirror).toBe(true);
    const start = new Date("2026-09-10T00:00:00");
    captured.dateClick?.({ date: start, allDay: true });
    expect(onSlotSelect).toHaveBeenCalledWith({
      start,
      end: null,
      allDay: true,
    });
  });

  it("forwards select range to onSlotSelect", () => {
    const onSlotSelect = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
        onSlotSelect={onSlotSelect}
      />,
    );
    const start = new Date("2026-09-10T00:00:00");
    const end = new Date("2026-09-13T00:00:00");
    captured.select?.({ start, end, allDay: true });
    expect(onSlotSelect).toHaveBeenCalledWith({ start, end, allDay: true });
  });

  it("does not enable selectable without onSlotSelect", () => {
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );
    expect(captured.selectable).toBe(false);
    expect(captured.dateClick).toBeUndefined();
  });

  it("enables droppable and forwards eventReceive as local due YMD", async () => {
    const onExternalTaskReceive = vi.fn().mockResolvedValue(undefined);
    const revert = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
        onExternalTaskReceive={onExternalTaskReceive}
      />,
    );
    expect(captured.droppable).toBe(true);
    await captured.eventReceive?.({
      event: {
        start: new Date(2026, 8, 15),
        extendedProps: { uniworkTaskId: "task-sidebar-1" },
      },
      revert,
    });
    expect(onExternalTaskReceive).toHaveBeenCalledWith({
      taskId: "task-sidebar-1",
      dueDate: "2026-09-15",
    });
    expect(revert).toHaveBeenCalled();
  });

  it("eventReceive reverts when task id is missing", async () => {
    const onExternalTaskReceive = vi.fn();
    const revert = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
        onExternalTaskReceive={onExternalTaskReceive}
      />,
    );
    await captured.eventReceive?.({
      event: { start: new Date(2026, 8, 15), extendedProps: {} },
      revert,
    });
    expect(onExternalTaskReceive).not.toHaveBeenCalled();
    expect(revert).toHaveBeenCalled();
  });

  it("eventResize reverts when handler rejects", async () => {
    const onEventDropOrResize = vi.fn().mockRejectedValue(new Error("patch failed"));
    const revert = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
        onEventDropOrResize={onEventDropOrResize}
      />,
    );
    await captured.eventResize?.({
      event: {
        id: "ev-1",
        start: new Date("2026-09-11T00:00:00.000Z"),
        end: new Date("2026-09-12T00:00:00.000Z"),
        allDay: true,
      },
      revert,
    });
    expect(revert).toHaveBeenCalled();
  });
});
