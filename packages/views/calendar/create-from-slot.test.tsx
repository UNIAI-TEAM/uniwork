import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CreateFromSlot } from "./create-from-slot";

initI18n();

const taskDialogProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const meetingDialogProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../tasks/create-task-dialog", () => ({
  CreateTaskDialog: (props: Record<string, unknown>) => {
    taskDialogProps.current = props;
    return props.open ? <div data-testid="create-task-dialog" /> : null;
  },
}));

vi.mock("../meetings/new-meeting-dialog", () => ({
  NewMeetingDialog: (props: Record<string, unknown>) => {
    meetingDialogProps.current = props;
    return props.open ? <div data-testid="create-meeting-dialog" /> : null;
  },
}));

describe("CreateFromSlot", () => {
  beforeEach(() => {
    taskDialogProps.current = {};
    meetingDialogProps.current = {};
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
        />,
      ),
    );

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Việc mới/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Cuộc họp mới/ })).toBeInTheDocument();
    expect(screen.queryByTestId("create-task-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-meeting-dialog")).not.toBeInTheDocument();
    expect(taskDialogProps.current).toEqual({});
    expect(meetingDialogProps.current).toEqual({});
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

  it("opens meeting creation with the selected schedule", () => {
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
        />,
      ),
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /Cuộc họp mới/ }));
    expect(screen.getByTestId("create-meeting-dialog")).toBeInTheDocument();
    expect(meetingDialogProps.current.scheduleDefaults).toEqual({
      date: "2026-09-10",
      start: "14:00",
      end: "15:00",
    });
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
        />,
      ),
    );

    fireEvent.keyDown(screen.getByRole("menu"), {
      key: "Escape",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.any(Object));
  });
});
