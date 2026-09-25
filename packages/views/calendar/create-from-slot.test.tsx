import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CreateFromSlot } from "./create-from-slot";

initI18n();

const taskDialogProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("../tasks/create-task-dialog", () => ({
  CreateTaskDialog: (props: Record<string, unknown>) => {
    taskDialogProps.current = props;
    return props.open ? <div data-testid="create-task-dialog" /> : null;
  },
}));

describe("CreateFromSlot", () => {
  it("opens task creation directly without a selected slot", () => {
    const onOpenChange = vi.fn();
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={onOpenChange}
          slot={null}
        />,
      ),
    );

    expect(screen.getByTestId("create-task-dialog")).toBeInTheDocument();
    expect(taskDialogProps.current.defaults).toBeUndefined();
    expect(taskDialogProps.current.onOpenChange).toBe(onOpenChange);
  });

  it("opens task creation directly with a due-date prefill", () => {
    render(
      wrap(
        <CreateFromSlot
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          slot={{
            start: new Date("2026-09-10T00:00:00"),
            end: null,
            allDay: true,
          }}
        />,
      ),
    );

    expect(screen.getByTestId("create-task-dialog")).toBeInTheDocument();
    expect(taskDialogProps.current.defaults).toEqual({ due_date: "2026-09-10" });
  });

  it("keeps a dragged hour range in direct task creation", () => {
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

    expect(taskDialogProps.current.defaults).toEqual({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: start.toISOString(),
      due_at: end.toISOString(),
    });
  });
});
