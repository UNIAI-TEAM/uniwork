import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { useCreateTaskDraftStore } from "@uniwork/core/tasks/stores/create-task-draft-store";
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

    const status = screen.getByRole("button", { name: "Trạng thái: Cần làm" });
    const priority = screen.getByRole("button", { name: "Độ ưu tiên: Không ưu tiên" });

    expect(status).toHaveClass("rounded-full");
    expect(priority).toHaveClass("rounded-full");
    expect(status).not.toHaveClass("w-full");
    expect(priority).not.toHaveClass("w-full");
    expect(status.querySelector('[data-slot="status-icon"]')).not.toBeNull();
    expect(priority.querySelector('[data-slot="priority-icon"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Không có dự án" })).toHaveTextContent("📁");
    expect(screen.getByRole("button", { name: "Chuyển sang agent" })).toHaveClass("pointer-coarse:min-h-11");
    expect(screen.getByTestId("create-task-composer-body")).toHaveClass("flex-1");
    expect(screen.getByTestId("create-task-property-toolbar")).toHaveClass("shrink-0");
    expect(screen.getByTestId("create-task-footer")).toHaveClass("sm:flex");
    expect(screen.getByTestId("create-task-footer")).toHaveClass(
      "border-surface-border/50",
    );
  });

  it("sends a submitter's task through it and leaves the person's own draft alone", async () => {
    // Draft writes need a session owner; without one every write is a no-op.
    setSessionUser({ id: "u1", email: "u1@x.com", display_name: "U1" } as User);
    const mine = { title: "Bản nháp của tôi", idempotencyKey: "mine", version: 3 };
    useCreateTaskDraftStore.setState({ drafts: { ws1: { mine } }, activeDraftIds: { ws1: "mine" }, ownerId: "u1" });
    const submit = vi.fn(async () => {});
    const onOpenChange = vi.fn();
    const { rerender } = render(
      wrap(
        <CreateTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          onOpenChange={onOpenChange}
          defaults={{ title: "Gửi biên bản", assignee_id: null, project_id: null }}
          submitter={{ submit, pending: false }}
          heading="Việc sau họp 1/2"
        />,
      ),
    );

    const title = screen.getByRole("textbox", { name: "Tiêu đề issue" });
    expect(title).toHaveValue("Gửi biên bản");
    expect(screen.getByText("Việc sau họp 1/2")).toBeInTheDocument();
    // No drafts, agent mode or "create another" of its own.
    expect(screen.queryByRole("button", { name: "Chuyển sang agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lưu bản nháp" })).not.toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Gửi biên bản họp" } });
    fireEvent.click(screen.getByRole("button", { name: /^Tạo/ }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ title: "Gửi biên bản họp" })));
    // The next item: the composer starts over on it, with the caret in its title.
    screen.getByRole("button", { name: /^Tạo/ }).focus();
    rerender(
      wrap(
        <CreateTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          onOpenChange={onOpenChange}
          defaults={{ title: "Đặt phòng", assignee_id: null, project_id: null }}
          submitter={{ submit, pending: false }}
          heading="Việc sau họp 2/2"
        />,
      ),
    );
    const next = await screen.findByDisplayValue("Đặt phòng");
    await waitFor(() => expect(next).toHaveFocus());

    expect(requestMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/tasks$/), expect.objectContaining({ method: "POST" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Closing asks nothing and drops nothing: the active draft is still the person's.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")).toEqual(mine);
    resetAuthStoreForTests();
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
