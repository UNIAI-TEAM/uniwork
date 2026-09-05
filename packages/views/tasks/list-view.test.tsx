import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { ListView } from "./list-view";

initI18n();

const task = (over: Record<string, unknown>) => ({
  id: "t1", workspace_id: "w1", title: "Việc", description: "", status: "todo", priority: "medium",
  position: 1, created_by: "u1", created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
  ...over,
});

beforeEach(() => requestMock.mockReset());

describe("ListView", () => {
  it("names the assignee from the resolved actor and badges an agent", async () => {
    requestMock.mockResolvedValue({
      tasks: [
        task({ id: "t1", title: "Cho người", assignee_id: "u2", assignee_kind: "human", assignee: { id: "u2", kind: "human", display_name: "Bình" } }),
        task({ id: "t2", title: "Cho UNI", assignee_id: "a1", assignee_kind: "agent", assignee: { id: "a1", kind: "agent", display_name: "UNI" } }),
        task({ id: "t3", title: "Việc trống" }),
      ],
    });
    render(wrap(<ListView workspaceId="w1" onOpenTask={() => {}} />));
    expect(await screen.findByText("Bình")).toBeInTheDocument();
    expect(screen.getByText("UNI")).toBeInTheDocument();
    expect(screen.getAllByText("Agent")).toHaveLength(1);
    expect(screen.getAllByText("Chưa giao")).toHaveLength(1);
  });

  it("renders an empty table without data", async () => {
    requestMock.mockResolvedValue({ tasks: [] });
    render(wrap(<ListView workspaceId="w1" onOpenTask={() => {}} />));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("Agent")).toBeNull();
  });
});
