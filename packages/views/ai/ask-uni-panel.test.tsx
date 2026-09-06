import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { configureShortcutPlatform } from "@uniwork/core/shortcuts";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniButton } from "./ask-uni-button";
import { AskUniPanel } from "./ask-uni-panel";

initI18n();
configureShortcutPlatform("macos");

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

const answer = {
  conversation_id: "c1",
  message: {
    id: "m2", role: "assistant", content: "Có 1 việc quá hạn: [S1] Viết spec.",
    citations: [{ source_id: "S1", quote: "Hạn: 2026-09-05", kind: "task", title: "Viết spec", href: "/acme/team/tasks/t1" }],
    created_at: "2026-09-06T08:00:00Z",
  },
  usage: { input_tokens: 812, output_tokens: 96 },
};

function mockApi(opts: { enabled?: boolean; askError?: ApiError; conversations?: unknown[] } = {}) {
  requestMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === "/api/v1/workspaces/ws1/ai/capabilities") {
      return Promise.resolve({ enabled: opts.enabled ?? true, ask_uni: true, meeting_summary: true, quota: { used_tokens: 0, limit_tokens: 500000 } });
    }
    if (path === "/api/v1/workspaces/ws1/ai/ask") return opts.askError ? Promise.reject(opts.askError) : Promise.resolve(answer);
    if (path === "/api/v1/workspaces/ws1/ai/conversations") return Promise.resolve({ conversations: opts.conversations ?? [] });
    if (path === "/api/v1/ai/conversations/c1/messages") {
      return Promise.resolve({ messages: [{ id: "m1", role: "user", content: "task nào quá hạn?", citations: [] }, answer.message] });
    }
    if (path === "/api/v1/ai/conversations/c1" && init?.method === "DELETE") return Promise.resolve({ status: "ok" });
    return Promise.resolve({});
  });
}

function mount() {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniButton />
        <AskUniPanel />
      </WorkspaceProvider>,
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
  useAiPanelStore.setState({ open: false, conversationId: null });
});

describe("AskUniPanel", () => {
  it("stays hidden while the server has no provider", async () => {
    mockApi({ enabled: false });
    mount();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws1/ai/capabilities"));
    expect(screen.queryByRole("button", { name: /Hỏi UNI/ })).toBeNull();
    useAiPanelStore.getState().setOpen(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens from the topbar button and ⌘J, shows the empty state, asks, and renders cited links", async () => {
    mockApi();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Hỏi UNI/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Bạn muốn biết gì về công việc của đội?")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Hỏi UNI…" }), { target: { value: "task nào quá hạn?" } });
    fireEvent.click(screen.getByRole("button", { name: "Hỏi" }));
    expect(await screen.findByText("Có 1 việc quá hạn: [S1] Viết spec.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /\[S1\]\s*Viết spec/ });
    expect(link).toHaveAttribute("href", "/acme/team/tasks/t1");
    expect(screen.getByText("812 token vào · 96 token ra")).toBeInTheDocument();
    expect(useAiPanelStore.getState().conversationId).toBe("c1");

    fireEvent.keyDown(window, { key: "j", metaKey: true });
    await waitFor(() => expect(useAiPanelStore.getState().open).toBe(false));
  });

  it("maps a quota error to its own sentence and keeps the question", async () => {
    mockApi({ askError: new ApiError("hết", "ai_quota_exceeded", 402) });
    mount();
    useAiPanelStore.getState().setOpen(true);
    fireEvent.change(await screen.findByRole("textbox", { name: "Hỏi UNI…" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Hỏi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tổ chức đã hết hạn mức token AI của tháng.");
    expect(screen.getByRole("textbox", { name: "Hỏi UNI…" })).toHaveValue("x");
  });

  it("lists my conversations, opens one, and deletes it", async () => {
    mockApi({ conversations: [{ id: "c1", title: "task nào quá hạn?", created_at: "", updated_at: "" }] });
    mount();
    useAiPanelStore.getState().setOpen(true);
    fireEvent.click(await screen.findByRole("button", { name: "task nào quá hạn?" }));
    expect(await screen.findByText("Có 1 việc quá hạn: [S1] Viết spec.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xóa hội thoại" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/conversations/c1", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(useAiPanelStore.getState().conversationId).toBeNull());
  });
});
