import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { MessageTaskCard } from "./message-task-card";

vi.mock("@uniwork/core/chat", () => ({
  useChatMessageLinks: () => ({
    data: [
      {
        id: "link1",
        message_id: "m1",
        target_type: "task",
        target_id: "t1",
        relation: "mentions",
      },
    ],
  }),
  useUnlinkChatMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

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

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("MessageTaskCard", () => {
  it("opens a centered peek dialog with compact fields", () => {
    wrap(<MessageTaskCard workspaceId="ws1" messageId="m1" />);

    expect(screen.queryByTestId("chat-task-peek-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "chat.link.open_task" }));
    expect(screen.getByTestId("chat-task-peek-dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("chat.link.title_label")).toHaveValue("long ơi");
    expect(screen.getByTestId("chat-task-peek-fields")).toBeInTheDocument();
    expect(screen.getByLabelText("tasks.status")).toBeInTheDocument();
    expect(screen.getByLabelText("chat.link.project_label")).toBeInTheDocument();
  });
});
