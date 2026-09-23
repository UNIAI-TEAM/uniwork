import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { AiTab } from "./ai-tab";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

const ENABLED = { enabled: true, ask_uni: true, meeting_summary: true, quota: { used_tokens: 1234, limit_tokens: 500000 } };

function mockApi(role: string, rows: unknown[], caps: Record<string, unknown> = ENABLED) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/workspaces/ws1/me") return Promise.resolve({ membership: { workspace_id: "ws1", user_id: "u1", role, source: "workspace" } });
    if (path === "/api/v1/workspaces/ws1/ai/capabilities") return Promise.resolve(caps);
    if (typeof path === "string" && path.startsWith("/api/v1/workspaces/ws1/ai/usage")) return Promise.resolve({ from: "", to: "", rows });
    return Promise.resolve({});
  });
}

beforeEach(() => requestMock.mockReset());

describe("AiTab", () => {
  it("is admin-only", async () => {
    mockApi("member", []);
    render(wrap(<WorkspaceProvider workspace={workspace} user={user}><AiTab /></WorkspaceProvider>));
    expect(await screen.findByText("Chỉ owner/admin workspace xem được")).toBeInTheDocument();
  });

  it("shows the organization's quota as a meter and the empty state", async () => {
    mockApi("admin", []);
    render(wrap(<WorkspaceProvider workspace={workspace} user={user}><AiTab /></WorkspaceProvider>));
    expect(await screen.findByText("Chưa có lượt gọi AI nào")).toBeInTheDocument();
    expect(screen.getByText("Hạn mức của tổ chức")).toBeInTheDocument();
    expect(screen.getByText("1.234 / 500.000 token")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Token AI" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("reads an unbounded quota as Không giới hạn", async () => {
    mockApi("admin", [], { ...ENABLED, quota: { used_tokens: 42, limit_tokens: null } });
    render(wrap(<WorkspaceProvider workspace={workspace} user={user}><AiTab /></WorkspaceProvider>));
    expect(await screen.findByText("42 token · Không giới hạn")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("says AI is off and who can turn it on, without inviting a try that would fail", async () => {
    mockApi("owner", [], { enabled: false });
    render(wrap(<WorkspaceProvider workspace={workspace} user={user}><AiTab /></WorkspaceProvider>));
    expect(await screen.findByText("AI chưa được bật cho tổ chức này")).toBeInTheDocument();
    expect(screen.getByText(/người vận hành UniWork/)).toBeInTheDocument();
    expect(screen.queryByText(/trên server/)).toBeNull();
    expect(screen.queryByText("Hạn mức của tổ chức")).toBeNull();
    // The usage query settles empty; nothing suggests opening Hỏi UNI.
    await waitFor(() => expect(requestMock.mock.calls.some(([p]) => String(p).includes("/ai/usage"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("Chưa có lượt gọi AI nào")).toBeNull());
    expect(screen.queryByText(/Hỏi UNI \(⌘J\)/)).toBeNull();
  });

  it("totals the rows, draws the sparkline and groups by capability", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockApi("owner", [
      { day: today, capability: "copilot_answer", actor_kind: "human", calls: 3, input_tokens: 300, output_tokens: 30, cost_micros: 4500 },
      { day: today, capability: "copilot_answer", actor_kind: "human", calls: 1, input_tokens: 100, output_tokens: 10, cost_micros: 1500 },
      { day: today, capability: "meeting_summarization", actor_kind: "human", calls: 1, input_tokens: 1000, output_tokens: 200, cost_micros: 30000 },
    ]);
    render(wrap(<WorkspaceProvider workspace={workspace} user={user}><AiTab /></WorkspaceProvider>));
    expect(await screen.findByRole("img", { name: "Token mỗi ngày" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Token theo ngày"));
    expect(screen.getByRole("cell", { name: today })).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument(); // calls
    expect(screen.getByText("1.400")).toBeInTheDocument(); // tokens in
    const byCapability = screen.getAllByRole("table").at(-1)!;
    const rows = within(byCapability).getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 groups
    expect(rows[1]).toHaveTextContent("Hỏi UNI");
    expect(rows[1]).toHaveTextContent("440");
  });
});
