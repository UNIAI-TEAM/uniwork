import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { DraggableMock } = vi.hoisted(() => {
  const destroy = vi.fn();
  const DraggableMock = vi.fn(function DraggableMock() {
    return { destroy };
  });
  return { DraggableMock };
});

vi.mock("@fullcalendar/interaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fullcalendar/interaction")>();
  return { ...actual, Draggable: DraggableMock };
});
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CalendarSidebar, EMPTY_CALENDAR_SIDEBAR } from "./calendar-sidebar";

initI18n();

describe("CalendarSidebar", () => {
  it("renders five section headings and empty copy when lists are empty", () => {
    render(
      wrap(
        <CalendarSidebar
          workspaceId="ws1"
          sections={EMPTY_CALENDAR_SIDEBAR}
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
          onCreateMeeting={() => {}}
        />,
      ),
    );

    expect(screen.getByText("Ưu tiên cao")).toBeInTheDocument();
    expect(screen.getByText("Hẹn gặp")).toBeInTheDocument();
    expect(screen.getByText("Giao cho tôi")).toBeInTheDocument();
    expect(screen.getByText("Hôm nay & quá hạn")).toBeInTheDocument();
    expect(screen.getByText("Tồn đọng")).toBeInTheDocument();
    expect(
      screen.getByText("Không có việc ưu tiên cao đang mở."),
    ).toBeInTheDocument();
    expect(screen.getByText("Chưa có cuộc họp sắp tới.")).toBeInTheDocument();
  });

  it("opens task or meeting detail when a row is clicked", () => {
    const onOpenTask = vi.fn();
    const onOpenMeeting = vi.fn();

    render(
      wrap(
        <CalendarSidebar
          workspaceId="ws1"
          sections={{
            ...EMPTY_CALENDAR_SIDEBAR,
            priorities: [
              {
                id: "task-1",
                title: "Fix sidebar",
                status: "open",
                priority: "high",
                dueDate: "2026-09-10",
              },
            ],
            meetWith: [
              {
                id: "meet-1",
                title: "Standup",
                startsAt: "2026-09-10T09:00:00+07:00",
                endsAt: "2026-09-10T09:30:00+07:00",
              },
            ],
          }}
          onOpenTask={onOpenTask}
          onOpenMeeting={onOpenMeeting}
          onCreateMeeting={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Fix sidebar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Standup/ }));

    expect(onOpenTask).toHaveBeenCalledWith("task-1");
    expect(onOpenMeeting).toHaveBeenCalledWith("meet-1");
  });

  it("attaches FullCalendar Draggable to task lists only", () => {
    DraggableMock.mockClear();
    render(
      wrap(
        <CalendarSidebar
          workspaceId="ws1"
          sections={{
            ...EMPTY_CALENDAR_SIDEBAR,
            priorities: [
              { id: "task-1", title: "Drag me", status: "open" },
            ],
            assigned: [{ id: "task-2", title: "Also drag", status: "open" }],
            meetWith: [
              {
                id: "meet-1",
                title: "Not draggable",
                startsAt: "2026-09-10T09:00:00+07:00",
                endsAt: "2026-09-10T09:30:00+07:00",
              },
            ],
          }}
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
          onCreateMeeting={() => {}}
        />,
      ),
    );

    expect(DraggableMock).toHaveBeenCalled();
    const firstOpts = DraggableMock.mock.calls[0]?.[1] as {
      itemSelector?: string;
      eventData?: (el: HTMLElement) => unknown;
    };
    expect(firstOpts.itemSelector).toBe("[data-calendar-external-task]");
    const handle = document.querySelector(
      "[data-calendar-external-task][data-task-id='task-1']",
    ) as HTMLElement;
    expect(handle.tagName).toBe("SPAN");
    expect(firstOpts.eventData?.(handle)).toEqual({
      title: "Drag me",
      duration: { days: 1 },
      extendedProps: { uniworkTaskId: "task-1" },
    });
    expect(
      document.querySelector("[data-calendar-external-task][data-task-id='meet-1']"),
    ).toBeNull();
  });

  it("calls onCreateMeeting from the meet-with CTA", () => {
    const onCreateMeeting = vi.fn();
    render(
      wrap(
        <CalendarSidebar
          workspaceId="ws1"
          sections={EMPTY_CALENDAR_SIDEBAR}
          onOpenTask={() => {}}
          onOpenMeeting={() => {}}
          onCreateMeeting={onCreateMeeting}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cuộc họp mới" }));
    expect(onCreateMeeting).toHaveBeenCalledTimes(1);
  });
});
