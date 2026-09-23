import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@uniwork/core/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { MessageTaskCard } from "./message-task-card";
import { ChatMessageLinksProvider } from "./chat-message-links-context";

const unlink = vi.fn();
vi.mock("@uniwork/core/chat", () => ({
  useUnlinkChatMessage: () => ({ mutateAsync: unlink, isPending: false }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
import { toast } from "sonner";

const LINKS = new Map([
  [
    "m1",
    [
      {
        id: "link1",
        message_id: "m1",
        target_type: "task",
        target_id: "t1",
        relation: "mentions",
        created_by: "",
        created_at: "",
      },
    ],
  ],
]);

beforeAll(() => {
  initI18n();
});

vi.mock("@uniwork/core/tasks", () => ({
  useTask: () => ({
    data: {
      id: "t1",
      identifier: "LUN-2",
      title: "long ơi",
      status: "todo",
      priority: "medium",
      revision: 1,
      description: "Từ chat",
      assignee_id: null,
      assignee_kind: "human",
      due_date: null,
      project_id: null,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePutTask: () => ({ mutate: vi.fn() }),
  useUpdateTask: () => ({ mutate: vi.fn() }),
  useProjects: () => ({ data: { projects: [] } }),
}));

vi.mock("@uniwork/core/workspaces", () => ({
  useMembers: () => ({ data: [] }),
}));

vi.mock("@uniwork/core/agents", () => ({
  useWorkspaceAgents: () => ({ data: [] }),
}));

function wrap(ui: ReactElement, canUnlink = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChatMessageLinksProvider value={{ linksByMessageId: LINKS, canUnlink }}>{ui}</ChatMessageLinksProvider>
    </QueryClientProvider>,
  );
}

describe("MessageTaskCard", () => {
  it("opens a centered peek dialog with compact fields", () => {
    wrap(<MessageTaskCard workspaceId="ws1" messageId="m1" />);

    expect(screen.queryByTestId("chat-task-peek-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mở LUN-2 · long ơi" }));
    expect(screen.getByTestId("chat-task-peek-dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Tiêu đề")).toHaveValue("long ơi");
    expect(screen.getByTestId("chat-task-peek-fields")).toBeInTheDocument();
    // Each field's trigger names the field and its current value.
    expect(screen.getByRole("button", { name: "Trạng thái: Cần làm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project: Không gắn" })).toBeInTheDocument();
  });

  it("offers unlink only with the right to write, and asks before unlinking", async () => {
    const { unmount } = wrap(<MessageTaskCard workspaceId="ws1" messageId="m1" />);
    expect(screen.queryByRole("button", { name: /Gỡ gắn/ })).toBeNull();
    unmount();

    unlink.mockRejectedValueOnce(new TypeError("offline"));
    wrap(<MessageTaskCard workspaceId="ws1" messageId="m1" />, true);
    await userEvent.click(screen.getByRole("button", { name: "Gỡ gắn LUN-2 · long ơi" }));
    expect(unlink).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Gỡ gắn việc" }));
    expect(unlink).toHaveBeenCalledWith({ messageId: "m1", linkId: "link1" });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
