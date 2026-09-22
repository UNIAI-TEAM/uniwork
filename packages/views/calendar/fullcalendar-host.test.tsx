import { render, screen } from "@testing-library/react";
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

  it("passes FC view and hiddenDays from viewMode", () => {
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="work_week"
        onDatesSet={vi.fn()}
        onEventClick={vi.fn()}
      />,
    );
    expect(captured.initialView).toBe("timeGridWeek");
    expect(captured.hiddenDays).toEqual([0, 6]);
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

  it("resolves eventClick by id", () => {
    const onEventClick = vi.fn();
    render(
      <FullCalendarHost
        events={[sample]}
        initialDate="2026-09-01"
        viewMode="month"
        onDatesSet={vi.fn()}
        onEventClick={onEventClick}
      />,
    );
    captured.eventClick?.({ event: { id: "ev-1" } });
    expect(onEventClick).toHaveBeenCalledWith(sample);
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

  it("eventDrop reverts when patch is null (timed task)", async () => {
    const onEventDropOrResize = vi.fn();
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
        start: new Date("2026-09-11T12:00:00.000Z"),
        end: new Date("2026-09-11T13:00:00.000Z"),
        allDay: false,
      },
      revert,
    });
    expect(onEventDropOrResize).not.toHaveBeenCalled();
    expect(revert).toHaveBeenCalled();
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
