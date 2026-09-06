import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { AiTab } from "./ai-tab";

initI18n();

const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

function mockApi(role: string, rows: unknown[]) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/workspaces/ws1/me") return Promise.resolve({ membership: { workspace_id: "ws1", user_id: "u1", role, source: "workspace" } });
    if (path === "/api/v1/workspaces/ws1/ai/capabilities") {
      return Promise.resolve({ enabled: true, ask_uni: true, meeting_summary: true, quota: { used_tokens: 1234, limit_tokens: 500000 } });
    }
    if (typeof path === "string" && path.startsWith("/api/v1/workspaces/ws1/ai/usage")) return Promise.resolve({ from: "", to: "", rows });
    return Promise.resolve({});
  });
}

beforeEach(() => requestMock.mockReset());

describe("AiTab", () => {
  it("is admin-only", async () => {
    mockApi("member", []);
    render(wrap(<WorkspaceProvider workspace={workspace}><AiTab /></WorkspaceProvider>));
    expect(await screen.findByText("Chỉ owner/admin workspace xem được")).toBeInTheDocument();
  });

  it("shows the quota line and the empty state", async () => {
    mockApi("admin", []);
    render(wrap(<WorkspaceProvider workspace={workspace}><AiTab /></WorkspaceProvider>));
    expect(await screen.findByText("Chưa có lượt gọi AI nào")).toBeInTheDocument();
    expect(await screen.findByText(/1.234 \/ 500.000 token/)).toBeInTheDocument();
  });

  it("totals the rows, draws the sparkline and groups by capability", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockApi("owner", [
      { day: today, capability: "copilot_answer", actor_kind: "human", calls: 3, input_tokens: 300, output_tokens: 30, cost_micros: 4500 },
      { day: today, capability: "copilot_answer", actor_kind: "human", calls: 1, input_tokens: 100, output_tokens: 10, cost_micros: 1500 },
      { day: today, capability: "meeting_summarization", actor_kind: "human", calls: 1, input_tokens: 1000, output_tokens: 200, cost_micros: 30000 },
    ]);
    render(wrap(<WorkspaceProvider workspace={workspace}><AiTab /></WorkspaceProvider>));
    expect(await screen.findByRole("img", { name: "Token mỗi ngày" })).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument(); // calls
    expect(screen.getByText("1.400")).toBeInTheDocument(); // tokens in
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 groups
    expect(rows[1]).toHaveTextContent("Hỏi UNI");
    expect(rows[1]).toHaveTextContent("440");
  });
});
