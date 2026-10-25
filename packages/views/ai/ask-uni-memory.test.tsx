import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { initI18n } from "@uniwork/core/i18n";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { user, workspace } from "./ask-uni-fixtures";
import { AskUniMemory } from "./ask-uni-memory";

initI18n();

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(toastMock, { error: vi.fn(), success: vi.fn() }) }));

const entry = (id: string, kind: string, text: string) => ({ id, kind, text, source: "user", created_at: "", updated_at: "" });
// The fixture workspace is organization "o1" with the slug "acme": the routes take the slug.
const LIST = "/api/v1/orgs/acme/ai/memory";
let list = { entries: [entry("m1", "preference", "Trả lời ngắn gọn"), entry("m2", "fact", "Tôi là kế toán")], on: true, limit: 50, remaining: 48 };

const calls = (method: string) => requestMock.mock.calls.filter(([, o]) => (o as { method?: string } | undefined)?.method === method);

beforeEach(() => {
  toastMock.mockReset();
  requestMock.mockReset();
  list = { entries: [entry("m1", "preference", "Trả lời ngắn gọn"), entry("m2", "fact", "Tôi là kế toán")], on: true, limit: 50, remaining: 48 };
  requestMock.mockImplementation((path: string, init?: { method?: string; body?: { enabled?: boolean } }) => {
    if (path === "/api/v1/me/ask-uni-memory") {
      list = { ...list, on: init?.body?.enabled ?? true };
      return Promise.resolve(undefined);
    }
    if (path === LIST && !init?.method) return Promise.resolve(list);
    return Promise.resolve(entry("m9", "fact", "x"));
  });
  useAiPanelStore.setState({ view: "memory", composerPrefill: null, workspaceId: "ws1" });
});

function mount() {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AskUniMemory orgSlug={workspace.organization_slug} />
      </WorkspaceProvider>,
    ),
  );
}

describe("AskUniMemory", () => {
  it("groups the entries and counts them", async () => {
    mount();
    expect(await screen.findByText("Trả lời ngắn gọn")).toBeInTheDocument();
    expect(screen.getByText("Cách UNI trả lời")).toBeInTheDocument();
    expect(screen.getByText("Về bạn")).toBeInTheDocument();
    expect(screen.getByText("2/50")).toBeInTheDocument();
    expect(screen.getByText(/Xóa một mục không xóa cuộc trò chuyện/)).toBeInTheDocument();
  });

  it("edits a line: Enter saves, Escape restores, an empty line saves nothing", async () => {
    mount();
    fireEvent.click(await screen.findByText("Trả lời ngắn gọn"));
    let box = screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" });
    fireEvent.change(box, { target: { value: "Trả lời chi tiết" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(`${LIST}/m1`, { method: "PATCH", body: { kind: "preference", text: "Trả lời chi tiết" } }));

    fireEvent.click(screen.getByText("Tôi là kế toán"));
    box = screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" });
    fireEvent.change(box, { target: { value: "Khác" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.getByText("Tôi là kế toán")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Tôi là kế toán"));
    box = screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" });
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(calls("PATCH")).toHaveLength(1);
  });

  it("deletes with an undo that creates the entry again", async () => {
    mount();
    await screen.findByText("Trả lời ngắn gọn");
    // Each delete button names its entry, so a screen reader tells the lines apart.
    fireEvent.click(screen.getByRole("button", { name: "Xóa mục: Trả lời ngắn gọn" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(`${LIST}/m1`, { method: "DELETE" }));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0]![0]).toBe("Đã xóa một mục");
    const action = (toastMock.mock.calls[0]![1] as { action: { label: string; onClick: () => void } }).action;
    expect(action.label).toBe("Hoàn tác");
    action.onClick();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(LIST, { method: "POST", body: { kind: "preference", text: "Trả lời ngắn gọn" } }));
  });

  it("reaches the delete button by keyboard and deletes with Enter", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByText("Trả lời ngắn gọn");
    await user.tab(); // back
    await user.tab(); // switch
    await user.tab(); // first line
    await user.tab(); // its delete button
    expect(screen.getByRole("button", { name: "Xóa mục: Trả lời ngắn gọn" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(`${LIST}/m1`, { method: "DELETE" }));
  });

  it("keeps the editor and the typed text when a save fails", async () => {
    mount();
    fireEvent.click(await screen.findByText("Trả lời ngắn gọn"));
    requestMock.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === "PATCH" ? Promise.reject(new ApiError("dup", "ai_memory_duplicate", 409)) : Promise.resolve(list),
    );
    const box = screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" });
    fireEvent.change(box, { target: { value: "Tôi là kế toán" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Mục này đã có trong bộ nhớ.");
    expect(screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" })).toHaveValue("Tôi là kế toán");
  });

  it("counts runes in the editor: 301 emoji are refused before any call, 300 save", async () => {
    mount();
    fireEvent.click(await screen.findByText("Trả lời ngắn gọn"));
    const box = screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" });
    fireEvent.change(box, { target: { value: "😀".repeat(301) } });
    expect(box).not.toHaveAttribute("maxlength"); // a UTF-16 maxLength would stop an emoji line early
    // The red border comes with its reason at once, not only after Enter.
    expect(screen.getByRole("alert")).toHaveTextContent("Mục không hợp lệ. Mỗi mục là một dòng, 1–300 ký tự.");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(calls("PATCH")).toHaveLength(0);
    fireEvent.change(box, { target: { value: "😀".repeat(300) } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(`${LIST}/m1`, { method: "PATCH", body: { kind: "preference", text: "😀".repeat(300) } }));
  });

  it.each([
    ["invalid_request", 400, "Mục không hợp lệ. Mỗi mục là một dòng, 1–300 ký tự."],
    ["not_found", 404, "Không còn tìm thấy mục này."],
    ["member_deactivated", 403, "Tài khoản của bạn trong tổ chức này đang bị vô hiệu hóa."],
    ["ai_memory_unavailable", 503, "Bộ nhớ chưa dùng được trên máy chủ này."],
  ])("explains %s on a refused save", async (code, status, copy) => {
    mount();
    fireEvent.click(await screen.findByText("Trả lời ngắn gọn"));
    requestMock.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === "PATCH" ? Promise.reject(new ApiError("x", code, status)) : Promise.resolve(list),
    );
    const box = screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" });
    fireEvent.change(box, { target: { value: "Trả lời khác" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
  });

  it("adds a fact", async () => {
    mount();
    await screen.findByText("Tôi là kế toán");
    const group = screen.getByText("Về bạn").closest("section")!;
    fireEvent.click(within(group).getByRole("button", { name: "Thêm" }));
    const box = screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" });
    fireEvent.change(box, { target: { value: "Làm ở Hà Nội" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(LIST, { method: "POST", body: { kind: "fact", text: "Làm ở Hà Nội" } }));
  });

  it("turns the memory off and says so", async () => {
    mount();
    await screen.findByText("Tôi là kế toán");
    expect(screen.queryByText("UNI đang không dùng bộ nhớ.")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Dùng bộ nhớ" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/me/ask-uni-memory", { method: "PUT", body: { enabled: false } }));
    expect(await screen.findByText("UNI đang không dùng bộ nhớ.")).toBeInTheDocument();
  });

  it("clears everything only after a confirmation that names the count", async () => {
    mount();
    await screen.findByText("Tôi là kế toán");
    fireEvent.click(screen.getByRole("button", { name: "Xóa toàn bộ bộ nhớ" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/2 mục sẽ bị xóa/)).toBeInTheDocument();
    expect(calls("DELETE")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa toàn bộ" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(LIST, { method: "DELETE" }));
  });

  it("edits by chat and opens the import flow", async () => {
    mount();
    await screen.findByText("Tôi là kế toán");
    fireEvent.click(screen.getByRole("button", { name: "Nhập từ AI khác" }));
    expect(useAiPanelStore.getState().view).toBe("memory-import");
    useAiPanelStore.setState({ view: "memory" });
    fireEvent.click(screen.getByRole("button", { name: "Sửa bằng cách nói với UNI" }));
    expect(useAiPanelStore.getState().view).toBe("thread");
    expect(useAiPanelStore.getState().composerPrefill).toBe("Cập nhật bộ nhớ của tôi: ");
  });

  it("goes back to the conversation", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Quay lại cuộc trò chuyện" }));
    expect(useAiPanelStore.getState().view).toBe("thread");
  });

  it("offers a first entry and the import on an empty memory", async () => {
    list = { ...list, entries: [], remaining: 50 };
    mount();
    expect(await screen.findByText("Chưa có gì trong bộ nhớ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nhập từ AI khác" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thêm mục" }));
    expect(screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" })).toBeInTheDocument();
  });

  it("tells a full memory to drop an entry", async () => {
    mount();
    await screen.findByText("Tôi là kế toán");
    requestMock.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method === "POST" ? Promise.reject(new ApiError("full", "ai_memory_full", 409)) : Promise.resolve(list),
    );
    const group = screen.getByText("Về bạn").closest("section")!;
    fireEvent.click(within(group).getByRole("button", { name: "Thêm" }));
    const box = screen.getByRole("textbox", { name: "Nội dung mục bộ nhớ" });
    fireEvent.change(box, { target: { value: "Thêm" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Bộ nhớ đã đủ 50 mục. Xóa bớt để thêm mục mới.");
  });
});
