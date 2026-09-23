import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { CreateTaskFromMessageDialog } from "./create-task-from-message-dialog";

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));

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

vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

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
    mocks.toastSuccess.mockReset();
  });

  it("prefills the title from the message body", () => {
    wrap(dialog);
    expect(screen.getByRole("textbox", { name: /Tiêu đề/ })).toHaveValue("Sửa bug login ngay hôm nay");
  });

  it("ignores Enter while an IME is composing", () => {
    mocks.mutateAsync.mockResolvedValue({ id: "t1" });
    wrap(dialog);
    const title = screen.getByRole("textbox", { name: /Tiêu đề/ });
    fireEvent.keyDown(title, { key: "Enter", keyCode: 229 });
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    fireEvent.keyDown(title, { key: "Enter" });
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("shows the failure inline, in its own words, not as a toast", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("boom"));
    wrap(dialog);
    fireEvent.keyDown(screen.getByRole("textbox", { name: /Tiêu đề/ }), { key: "Enter" });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Không tạo được việc. Thử lại sau giây lát.");
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("confirms a created task with a toast", async () => {
    mocks.mutateAsync.mockResolvedValue({ id: "t9" });
    wrap(dialog);
    fireEvent.keyDown(screen.getByRole("textbox", { name: /Tiêu đề/ }), { key: "Enter" });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Đã tạo việc", expect.anything()));
  });

  it("gives the title a visible label and explains an empty one", () => {
    wrap(dialog);
    const title = screen.getByRole("textbox", { name: /Tiêu đề/ });
    expect(document.querySelector(`label[for="${title.id}"]`)).not.toBeNull();
    fireEvent.change(title, { target: { value: "  " } });
    expect(screen.getByText("Cần tiêu đề việc")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tạo việc" })).toBeDisabled();
  });

  it("offers agents as assignees, marked as agents", () => {
    wrap(dialog);
    fireEvent.click(screen.getByRole("combobox", { name: /Người phụ trách/ }));
    const agent = screen.getByRole("option", { name: /Trợ lý/ });
    expect(within(agent).getByText("Agent")).toBeInTheDocument();
    expect(within(screen.getByRole("option", { name: /Lan/ })).queryByText("Agent")).toBeNull();
  });

  it("offers to open the created task from the toast", async () => {
    mocks.mutateAsync.mockResolvedValue({ id: "t9" });
    const push = vi.fn();
    const nav = { push, replace: vi.fn(), back: vi.fn(), pathname: "/", searchParams: new URLSearchParams() };
    const workspace = { id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" };
    const user = { id: "u1", email: "a@b.co", display_name: "A" };
    wrap(
      <NavigationProvider value={nav as unknown as NavigationAdapter}>
        <WorkspaceProvider workspace={workspace as never} user={user as never}>
          {dialog}
        </WorkspaceProvider>
      </NavigationProvider>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: /Tiêu đề/ }), { key: "Enter" });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    const options = mocks.toastSuccess.mock.calls[0]?.[1] as { action: { label: string; onClick: () => void } };
    expect(options.action.label).toBe("Mở");
    options.action.onClick();
    expect(push).toHaveBeenCalledWith("/acme/team/tasks/t9");
  });
});
