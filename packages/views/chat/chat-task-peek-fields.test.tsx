import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { Task } from "@uniwork/core/types";
import { ChatTaskAssigneeField, ChatTaskPeekFields } from "./chat-task-peek-fields";

vi.mock("@uniwork/core/tasks", () => ({
  useUpdateTask: () => ({ mutate: vi.fn() }),
  useProjects: () => ({ data: { projects: [{ id: "p1", title: "Ra mắt" }] } }),
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
    data: [{ id: "a1", name: "Trợ lý", avatar_url: undefined }],
    isLoading: false,
    isError: false,
  }),
}));

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const task = {
  id: "t1",
  identifier: "LUN-2",
  title: "long ơi",
  status: "todo",
  priority: "medium",
  assignee_id: "a1",
  assignee_kind: "agent",
  due_date: null,
  project_id: "p1",
} as unknown as Task;

describe("ChatTaskPeekFields", () => {
  it("names each chip with its field and current value", () => {
    wrap(<ChatTaskPeekFields workspaceId="ws1" task={task} />);
    expect(screen.getByRole("button", { name: "Trạng thái: Cần làm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Độ ưu tiên: Trung bình" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project: Ra mắt" })).toBeInTheDocument();
  });

  it("marks an agent assignee with the agent badge", () => {
    wrap(<ChatTaskPeekFields workspaceId="ws1" task={task} />);
    const trigger = screen.getByRole("combobox", { name: "Người phụ trách: Trợ lý (Agent)" });
    expect(within(trigger).getByText("Agent")).toBeInTheDocument();
  });
});

describe("ChatTaskAssigneeField", () => {
  it("lists people and agents, with agents badged", () => {
    wrap(<ChatTaskAssigneeField workspaceId="ws1" value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách: Chưa giao" }));
    const human = screen.getByRole("option", { name: /Lan/ });
    const agent = screen.getByRole("option", { name: /Trợ lý/ });
    expect(within(human).queryByText("Agent")).toBeNull();
    expect(within(agent).getByText("Agent")).toBeInTheDocument();
  });
});
