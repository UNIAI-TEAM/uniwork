import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { CreateTaskDialog } from "./create-task-dialog";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

initI18n();

describe("CreateTaskDialog", () => {
  beforeEach(() => {
    toastError.mockReset();
    requestMock.mockReset();
    requestMock.mockImplementation(async () => ({}));
  });

  it("switches body mode without unmounting the dialog role", () => {
    render(
      wrap(
        <CreateTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang agent" }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByText(/sẽ bắt đầu làm ngay sau khi tạo/)).toBeInTheDocument();
  });

  it("shows agent unavailable toast and does not POST /tasks when creating in agent mode", async () => {
    render(
      wrap(
        <CreateTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          initialMode="agent"
          onOpenChange={() => {}}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tạo", exact: true }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(requestMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/tasks$/),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
