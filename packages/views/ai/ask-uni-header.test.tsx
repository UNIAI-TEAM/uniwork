import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniHeader } from "./ask-uni-header";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};
const conversations = [
  { id: "c1", title: "Task quá hạn", created_at: "2026-09-06T08:00:00Z", updated_at: "2026-09-06T08:00:00Z" },
  { id: "c2", title: "Họp tuần", created_at: "2026-09-05T08:00:00Z", updated_at: "2026-09-05T08:00:00Z" },
];

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === "/api/v1/workspaces/ws1/ai/conversations") return Promise.resolve({ conversations });
    if (path.startsWith("/api/v1/ai/conversations/") && init?.method) return Promise.resolve({ ...conversations[0], title: "Mới" });
    return Promise.resolve({});
  });
  useAiPanelStore.setState({ open: true, conversationId: "c1", workspaceId: "ws1", fullPage: false });
});

function mount() {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniHeader />
      </WorkspaceProvider>,
    ),
  );
}

async function openHistory() {
  fireEvent.click(await screen.findByRole("button", { name: "Lịch sử hội thoại: Task quá hạn" }));
  return screen.findByText("Họp tuần");
}

describe("AskUniHeader", () => {
  it("offers no full-page button on a phone", async () => {
    const width = window.innerWidth;
    window.innerWidth = 500;
    try {
      mount();
      await screen.findByRole("button", { name: "Lịch sử hội thoại: Task quá hạn" });
      await waitFor(() => expect(screen.queryByRole("button", { name: "Mở rộng toàn trang" })).toBeNull());
    } finally {
      window.innerWidth = width;
    }
  });

  it("sends one rename for a double Enter", async () => {
    let resolve: (v: unknown) => void = () => {};
    requestMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === "/api/v1/workspaces/ws1/ai/conversations") return Promise.resolve({ conversations });
      if (init?.method === "PATCH") return new Promise((r) => (resolve = r));
      return Promise.resolve({});
    });
    mount();
    await openHistory();
    fireEvent.click(screen.getAllByRole("button", { name: "Đổi tên hội thoại" })[1]!);
    const input = screen.getByRole("textbox", { name: "Đổi tên hội thoại" });
    fireEvent.change(input, { target: { value: "Họp quý" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(requestMock.mock.calls.filter(([, o]) => (o as { method?: string } | undefined)?.method === "PATCH")).toHaveLength(1));
    fireEvent.keyDown(input, { key: "Enter" });
    // query-core awaits onMutate before the mutation function runs: let a second PATCH reach the transport.
    await act(async () => {});
    resolve({});
    expect(requestMock.mock.calls.filter(([, o]) => (o as { method?: string } | undefined)?.method === "PATCH")).toHaveLength(1);
  });

  it("lists the history in a named popover and selects a conversation", async () => {
    mount();
    const item = await openHistory();
    expect(screen.getByRole("dialog", { name: "Lịch sử hội thoại" })).toBeInTheDocument();
    fireEvent.click(item);
    expect(useAiPanelStore.getState().conversationId).toBe("c2");
  });

  it("starts a new conversation, toggles full page and closes", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Hội thoại mới" }));
    expect(useAiPanelStore.getState().conversationId).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mở rộng toàn trang" }));
    expect(useAiPanelStore.getState().fullPage).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Thu về thanh bên" }));
    expect(useAiPanelStore.getState().fullPage).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(useAiPanelStore.getState().open).toBe(false);
  });

  it("renames inline: Enter saves, Escape cancels", async () => {
    mount();
    await openHistory();
    fireEvent.click(screen.getAllByRole("button", { name: "Đổi tên hội thoại" })[1]!);
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Đổi tên hội thoại" });
    // The old name is selected, so typing replaces it.
    await waitFor(() => expect([input.selectionStart, input.selectionEnd]).toEqual([0, "Họp tuần".length]));
    fireEvent.change(input, { target: { value: "Họp quý" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/conversations/c2", { method: "PATCH", body: { title: "Họp quý" } }),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Đổi tên hội thoại" })[0]!);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Đổi tên hội thoại" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Đổi tên hội thoại" })).toBeNull();
    expect(requestMock.mock.calls.filter(([, o]) => (o as { method?: string } | undefined)?.method === "PATCH")).toHaveLength(1);
  });

  it("deletes through a confirmation, and deleting the open conversation selects none", async () => {
    mount();
    await openHistory();
    fireEvent.click(screen.getAllByRole("button", { name: "Xóa hội thoại" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/ai/conversations/c1", { method: "DELETE" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa hẳn" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/conversations/c1", { method: "DELETE" }));
    await waitFor(() => expect(useAiPanelStore.getState().conversationId).toBeNull());
  });
});
