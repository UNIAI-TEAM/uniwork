import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CreateFromSlot } from "./create-from-slot";

initI18n();

const taskDialogProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const cardProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const sheetProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../tasks/create-task-dialog", () => ({
  CreateTaskDialog: (props: Record<string, unknown>) => {
    taskDialogProps.current = props;
    return props.open ? <div data-testid="create-task-dialog" /> : null;
  },
}));

vi.mock("./meeting-quick-card", () => ({
  MeetingQuickCard: (props: Record<string, unknown>) => {
    cardProps.current = props;
    return <div data-testid="meeting-quick-card" />;
  },
}));

vi.mock("../meetings/meeting-sheet", () => ({
  MeetingSheet: (props: Record<string, unknown>) => {
    sheetProps.current = props;
    return props.open ? <div data-testid="meeting-sheet" /> : null;
  },
}));

const windowOf = (draft: unknown) => {
  const d = draft as { date: string; start: string; end: string };
  return { date: d.date, start: d.start, end: d.end };
};

describe("CreateFromSlot", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T09:55:00"));
    taskDialogProps.current = {};
    cardProps.current = {};
    sheetProps.current = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens an anchored creation menu with both item types", () => {
    const onOpenChange = vi.fn();
    const anchor = document.createElement("button");
    document.body.append(anchor);
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={onOpenChange}
          slot={null}
          anchor={anchor}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Việc mới/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Cuộc họp mới/ })).toBeInTheDocument();
    expect(screen.queryByTestId("create-task-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("meeting-quick-card")).not.toBeInTheDocument();
    expect(taskDialogProps.current).toEqual({});
    expect(cardProps.current).toEqual({});
  });

  it("opens task creation with a due-date prefill", () => {
    const onOpenChange = vi.fn();
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={onOpenChange}
          slot={{
            start: new Date("2026-09-10T00:00:00"),
            end: null,
            allDay: true,
          }}
          anchor={document.body}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /Việc mới/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("create-task-dialog")).toBeInTheDocument();
    expect(taskDialogProps.current.defaults).toEqual({ due_date: "2026-09-10" });
  });

  it("keeps a dragged hour range in task creation", () => {
    const start = new Date("2026-09-10T14:00:00");
    const end = new Date("2026-09-10T15:00:00");
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          slot={{ start, end, allDay: false }}
          anchor={document.body}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /Việc mới/ }));
    expect(taskDialogProps.current.defaults).toEqual({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: start.toISOString(),
      due_at: end.toISOString(),
    });
  });

  it("opens the quick card with the selected schedule, not the full sheet", () => {
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          slot={{
            start: new Date("2026-09-10T14:00:00"),
            end: new Date("2026-09-10T15:00:00"),
            allDay: false,
          }}
          anchor={document.body}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    expect(screen.getByText("Thứ Năm 10/09 · 14:00–15:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Cuộc họp mới/ }));
    expect(screen.getByTestId("meeting-quick-card")).toBeInTheDocument();
    expect(screen.queryByTestId("meeting-sheet")).not.toBeInTheDocument();
    expect(windowOf(cardProps.current.initial)).toEqual({
      date: "2026-09-10",
      start: "14:00",
      end: "15:00",
    });
  });

  it("hands the card's draft to the sheet on Thêm tùy chọn and closes the card", () => {
    const onOpenMeeting = vi.fn();
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          slot={{ start: new Date("2026-09-10T14:00:00"), end: new Date("2026-09-10T15:00:00"), allDay: false }}
          anchor={document.body}
          onOpenMeeting={onOpenMeeting}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Cuộc họp mới/ }));
    expect(cardProps.current.onOpenMeeting).toBe(onOpenMeeting);
    const draft = { ...(cardProps.current.initial as object), title: "Duyệt kịch bản" };
    act(() => (cardProps.current.onMoreOptions as (d: unknown, key: string) => void)(draft, "k-card"));
    expect(screen.queryByTestId("meeting-quick-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("meeting-sheet")).toBeInTheDocument();
    expect(sheetProps.current).toMatchObject({ mode: "create", initialDraft: draft, idempotencyKey: "k-card" });
  });

  it("starts a meeting on today's day cell at the next quarter hour", () => {
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          slot={{ start: new Date("2026-09-10T00:00:00"), end: null, allDay: true }}
          anchor={document.body}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /Cuộc họp mới/ }));
    expect(windowOf(cardProps.current.initial)).toEqual({
      date: "2026-09-10",
      start: "10:00",
      end: "11:00",
    });
  });

  it("does not offer a meeting in a slot that has passed, but still offers a task", () => {
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          slot={{
            start: new Date("2026-09-10T08:00:00"),
            end: new Date("2026-09-10T09:00:00"),
            allDay: false,
          }}
          anchor={document.body}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    const meeting = screen.getByRole("menuitem", { name: /Cuộc họp mới/ });
    expect(meeting).toHaveAttribute("aria-disabled", "true");
    expect(meeting).toHaveTextContent("Không thể đặt cuộc họp vào thời gian đã qua");
    fireEvent.click(meeting);
    expect(screen.queryByTestId("meeting-quick-card")).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Việc mới/ })).not.toHaveAttribute("aria-disabled");
  });

  it("does not offer a meeting on a day that has passed", () => {
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          slot={{ start: new Date("2026-09-09T00:00:00"), end: null, allDay: true }}
          anchor={document.body}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    expect(screen.getByRole("menuitem", { name: /Cuộc họp mới/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("closes the composer with Escape", () => {
    const onOpenChange = vi.fn();
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={onOpenChange}
          slot={null}
          anchor={document.body}
          onOpenMeeting={() => {}}
        />,
      ),
    );

    fireEvent.keyDown(screen.getByRole("menu"), {
      key: "Escape",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.any(Object));
  });
});
