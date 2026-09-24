import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  it("uses generic create copy when opened without a selected slot", () => {
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          slot={null}
        />,
      ),
    );

    expect(screen.getByRole("heading", { name: "Tạo mục lịch" })).toBeInTheDocument();
  });

  it("opens task dialog with due_date prefill after choosing new task", () => {
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
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Việc mới" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("create-task-dialog")).toBeInTheDocument();
    expect(taskDialogProps.current.defaults).toEqual({ due_date: "2026-09-10" });
  });

  it("keeps a dragged hour range when opening the task dialog", () => {
    const start = new Date("2026-09-10T14:00:00");
    const end = new Date("2026-09-10T15:00:00");
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          slot={{ start, end, allDay: false }}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Việc mới" }));
    expect(taskDialogProps.current.defaults).toEqual({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: start.toISOString(),
      due_at: end.toISOString(),
    });
  });

  it("opens meeting dialog with schedule prefill after choosing new meeting", () => {
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
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cuộc họp mới" }));
    expect(screen.getByTestId("create-meeting-dialog")).toBeInTheDocument();
    expect(meetingDialogProps.current.scheduleDefaults).toEqual({
      date: "2026-09-10",
      start: "14:00",
      end: "15:00",
    });
  });
});
