import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), toastError: vi.fn() }));

vi.mock("@uniwork/core/chat", () => ({
  useCreateTaskFromChatMessage: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@uniwork/core/tasks", () => ({
  useProjects: () => ({ data: { projects: [] } }),
}));

vi.mock("@uniwork/core/workspaces", () => ({
  useMembers: () => ({
    data: [{ user_id: "u1", display_name: "Lan", email: "lan@x.vn" }],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@uniwork/core/agents", () => ({
  useWorkspaceAgents: () => ({
    data: [{ id: "a1", name: "Trợ lý" }],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const dialog = (
  <CreateTaskFromMessageDialog
    open
    onOpenChange={vi.fn()}
    workspaceId="ws1"
    messageId="m1"
    messageBody="Sửa bug login ngay hôm nay"
  />
);

describe("CreateTaskFromMessageDialog", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.toastError.mockReset();
  });

  it("prefills the title from the message body", () => {
    wrap(dialog);
    expect(screen.getByLabelText("Tiêu đề")).toHaveValue("Sửa bug login ngay hôm nay");
  });

  it("ignores Enter while an IME is composing", () => {
    mocks.mutateAsync.mockResolvedValue({ id: "t1" });
    wrap(dialog);
    const title = screen.getByLabelText("Tiêu đề");
    fireEvent.keyDown(title, { key: "Enter", keyCode: 229 });
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    fireEvent.keyDown(title, { key: "Enter" });
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("shows the failure when creating fails", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("boom"));
    wrap(dialog);
    fireEvent.keyDown(screen.getByLabelText("Tiêu đề"), { key: "Enter" });
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
  });

  it("offers agents as assignees, marked as agents", () => {
    wrap(dialog);
    fireEvent.click(screen.getByRole("combobox", { name: /Người phụ trách/ }));
    const agent = screen.getByRole("option", { name: /Trợ lý/ });
    expect(within(agent).getByText("Agent")).toBeInTheDocument();
    expect(within(screen.getByRole("option", { name: /Lan/ })).queryByText("Agent")).toBeNull();
  });
});
