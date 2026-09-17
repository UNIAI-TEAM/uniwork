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

  it("renders the manual composer with compact Multica property pills", () => {
    render(
      wrap(
        <CreateTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );

    const status = screen.getByRole("combobox", { name: "Trạng thái" });
    const priority = screen.getByRole("combobox", { name: "Độ ưu tiên" });

    expect(status).toHaveClass("rounded-full");
    expect(priority).toHaveClass("rounded-full");
    expect(status).not.toHaveClass("w-full");
    expect(priority).not.toHaveClass("w-full");
    expect(status.querySelector('[data-slot="status-icon"]')).not.toBeNull();
    expect(priority.querySelector('[data-slot="priority-icon"]')).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "Dự án" })).toHaveTextContent("📁");
    expect(screen.getByTestId("create-task-composer-body")).toHaveClass("flex-1");
    expect(screen.getByTestId("create-task-property-toolbar")).toHaveClass("shrink-0");
    expect(screen.getByTestId("create-task-footer")).toHaveClass("sm:flex");
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
    fireEvent.click(screen.getByRole("button", { name: /^Tạo$/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(requestMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/tasks$/),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
