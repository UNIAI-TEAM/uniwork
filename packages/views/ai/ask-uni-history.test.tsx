import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniHistory } from "./ask-uni-history";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};
const now = new Date().toISOString();
const conversations = [
  { id: "c1", title: "Task quá hạn", created_at: now, updated_at: now },
  { id: "c2", title: "Họp tuần", created_at: "2020-01-05T08:00:00Z", updated_at: "2020-01-05T08:00:00Z" },
];
const LIST = "/api/v1/workspaces/ws1/ai/conversations";

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === LIST) return Promise.resolve({ conversations });
    if (path.startsWith(`${LIST}?q=`)) {
      return Promise.resolve({ conversations: path.includes("zzzz") ? [] : [conversations[0]] });
    }
    if (init?.method) return Promise.resolve({ ...conversations[0], title: "Mới" });
    return Promise.resolve({});
  });
  useAiPanelStore.setState({ open: true, conversationId: "c1", workspaceId: "ws1" });
});

async function open() {
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniHistory title="Task quá hạn" />
      </WorkspaceProvider>,
    ),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Lịch sử hội thoại: Task quá hạn" }));
  await screen.findByText("Họp tuần");
}
function firstButton(name: string): HTMLElement {
  const el = screen.getAllByRole("button", { name })[0];
  if (!el) throw new Error(`no button ${name}`);
  return el;
}
const searchCalls = () => requestMock.mock.calls.map((c) => c[0] as string).filter((p) => p.includes("?q="));

describe("AskUniHistory", () => {
  it("groups, marks the open row and keeps the actions focusable", async () => {
    await open();
    expect(screen.getByText("Hôm nay")).toBeTruthy();
    expect(screen.getByText("Cũ hơn")).toBeTruthy();
    const current = document.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("Task quá hạn");
    const rename = firstButton("Đổi tên hội thoại");
    expect(rename.className).toContain("opacity-0");
    expect(rename.className).toContain("group-focus-within:opacity-100");
    rename.focus();
    expect(document.activeElement).toBe(rename);
  });

  it("moves between the search box and the rows with the arrow keys", async () => {
    await open();
    const search = screen.getByRole("searchbox", { name: "Tìm hội thoại" });
    search.focus();
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-history-row]"));
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Task quá hạn"), expect.stringContaining("Họp tuần")]);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: "ArrowUp" });
    fireEvent.keyDown(rows[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(search);
  });

  it("searches after the debounce with the trimmed query", async () => {
    await open();
    await userEvent.type(screen.getByRole("searchbox", { name: "Tìm hội thoại" }), "viec tre");
    await waitFor(() => expect(searchCalls()).toEqual([`${LIST}?q=viec%20tre`]));
  });

  it("sends no q for one rune and sends q for a two-rune Vietnamese input", async () => {
    await open();
    const box = screen.getByRole("searchbox", { name: "Tìm hội thoại" });
    await userEvent.type(box, "đ");
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(searchCalls()).toEqual([]);
    await userEvent.type(box, "i");
    await waitFor(() => expect(searchCalls()).toEqual([`${LIST}?q=${encodeURIComponent("đi")}`]));
  });

  it("shows the no-match text when a search finds nothing", async () => {
    await open();
    await userEvent.type(screen.getByRole("searchbox", { name: "Tìm hội thoại" }), "zzzz");
    expect(await screen.findByText("Không có hội thoại nào khớp")).toBeTruthy();
  });

  it("keeps the previous results while a search loads", async () => {
    await open();
    requestMock.mockImplementation((path: string) =>
      path.includes("?q=") ? new Promise(() => {}) : Promise.resolve({ conversations }),
    );
    await userEvent.type(screen.getByRole("searchbox", { name: "Tìm hội thoại" }), "ab");
    await waitFor(() => expect(searchCalls().length).toBe(1));
    expect(screen.getByText("Họp tuần")).toBeTruthy();
    expect(screen.queryByText("Không có hội thoại nào khớp")).toBeNull();
  });

  it("returns to the plain list when the box is cleared", async () => {
    await open();
    const box = screen.getByRole("searchbox", { name: "Tìm hội thoại" });
    await userEvent.type(box, "zzzz");
    await screen.findByText("Không có hội thoại nào khớp");
    await userEvent.clear(box);
    expect(await screen.findByText("Họp tuần")).toBeTruthy();
    expect(screen.queryByText("Không có hội thoại nào khớp")).toBeNull();
  });

  it("shows an error with retry and no stale rows when a search fails", async () => {
    await open();
    requestMock.mockImplementation((path: string) =>
      path.includes("?q=") ? Promise.reject(new Error("boom")) : Promise.resolve({ conversations }),
    );
    await userEvent.type(screen.getByRole("searchbox", { name: "Tìm hội thoại" }), "ab");
    expect(await screen.findByText("Không tải được lịch sử hội thoại")).toBeTruthy();
    expect(screen.queryByText("Họp tuần")).toBeNull();
    expect(screen.queryByText("Không có hội thoại nào khớp")).toBeNull();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeTruthy();
  });

  it("does not show the previous workspace's rows after a switch", async () => {
    const ws2 = { ...workspace, id: "ws2", slug: "other" };
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/workspaces/ws2/ai/conversations"
        ? new Promise(() => {})
        : Promise.resolve({ conversations }),
    );
    const tree = (w: Workspace) =>
      wrapWithNav(
        <WorkspaceProvider workspace={w} user={user}>
          <AskUniHistory title="Task quá hạn" />
        </WorkspaceProvider>,
      );
    const { rerender } = render(tree(workspace));
    fireEvent.click(await screen.findByRole("button", { name: "Lịch sử hội thoại: Task quá hạn" }));
    await screen.findByText("Họp tuần");
    rerender(tree(ws2));
    await waitFor(() => expect(screen.queryByText("Họp tuần")).toBeNull());
  });

  it("still renames and deletes", async () => {
    await open();
    fireEvent.click(firstButton("Đổi tên hội thoại"));
    const input = await screen.findByRole("textbox", { name: "Đổi tên hội thoại" });
    fireEvent.change(input, { target: { value: "Mới" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(requestMock.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === "PATCH")).toBe(true));
    fireEvent.click(firstButton("Xóa hội thoại"));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa hẳn" }));
    await waitFor(() => expect(requestMock.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === "DELETE")).toBe(true));
  });
});
