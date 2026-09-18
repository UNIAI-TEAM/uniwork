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

  it("switches body mode without unmounting the dialog role", async () => {
    render(
      wrap(
        <CreateTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang agent" }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(
      await screen.findByRole("textbox", { name: "Yêu cầu cho agent" }),
    ).toBeInTheDocument();
  });

  it("renders the manual composer with compact property pills", () => {
    render(
      wrap(
        <CreateTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );

    const status = screen.getByRole("button", { name: "Cần làm" });
    const priority = screen.getByRole("button", { name: "Không ưu tiên" });

    expect(status).toHaveClass("rounded-full");
    expect(priority).toHaveClass("rounded-full");
    expect(status).not.toHaveClass("w-full");
    expect(priority).not.toHaveClass("w-full");
    expect(status.querySelector('[data-slot="status-icon"]')).not.toBeNull();
    expect(priority.querySelector('[data-slot="priority-icon"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Không có dự án" })).toHaveTextContent("📁");
    expect(screen.getByTestId("create-task-composer-body")).toHaveClass("flex-1");
    expect(screen.getByTestId("create-task-property-toolbar")).toHaveClass("shrink-0");
    expect(screen.getByTestId("create-task-footer")).toHaveClass("sm:flex");
    expect(screen.getByTestId("create-task-footer")).toHaveClass(
      "border-surface-border/50",
    );
  });

  it("shows agent unavailable toast and does not POST /tasks when creating in agent mode", async () => {
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/agents")) {
        return {
          agents: [
            {
              id: "agent-1",
              organization_id: "o1",
              name: "Agent 17",
              handle: "agent-17",
              description: "",
              status: "active",
              owner_user_id: "u1",
            },
          ],
        };
      }
      if (path.endsWith("/projects")) return { projects: [], total: 0 };
      if (path.endsWith("/tasks") && init?.method !== "POST") return { tasks: [] };
      return {};
    });

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

    const editor = await screen.findByRole("textbox", { name: "Yêu cầu cho agent" });
    await screen.findByText("Agent 17");
    fireEvent.input(editor, { target: { innerHTML: "<p>Viết summary</p>" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Gửi cho agent/ })).not.toHaveAttribute(
        "aria-disabled",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Gửi cho agent/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(requestMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/tasks$/),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
