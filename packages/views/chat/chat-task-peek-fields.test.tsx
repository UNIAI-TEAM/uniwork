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
    wrap(<ChatTaskPeekFields workspaceId="ws1" task={task} onPatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Trạng thái: Cần làm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Độ ưu tiên: Trung bình" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project: Ra mắt" })).toBeInTheDocument();
  });

  it("marks an agent assignee with the agent badge", () => {
    wrap(<ChatTaskPeekFields workspaceId="ws1" task={task} onPatch={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Người phụ trách: Trợ lý (Agent)" });
    expect(within(trigger).getByText("Agent")).toBeInTheDocument();
  });
});

describe("ChatTaskAssigneeField", () => {
  it("lists people and agents in their own groups", () => {
    wrap(<ChatTaskAssigneeField workspaceId="ws1" value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Người phụ trách: Chưa giao" }));
    const human = screen.getByRole("button", { name: "Lan" });
    const agent = screen.getByRole("button", { name: "Trợ lý" });
    const membersGroup = screen.getByText("Thành viên").parentElement;
    const agentsGroup = screen.getByText("Agent").parentElement;
    expect(membersGroup).toContainElement(human);
    expect(agentsGroup).toContainElement(agent);
    expect(agentsGroup).not.toContainElement(human);
  });
});
