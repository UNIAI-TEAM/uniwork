import { act, createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniObjectPicker, type AskUniObjectKind, type AskUniObjectPickerHandle } from "./ask-uni-object-picker";

initI18n();

const task = (id: string, title: string, extra: object = {}) => ({
  id, workspace_id: "ws1", identifier: id, title, description: "", created_by: "u1", status: "in_progress",
  priority: "medium", position: 1, revision: 1, created_at: "", updated_at: "", ...extra,
});
const rows = [
  { task: task("t1", "Hoàn thiện báo cáo", { assignee: { id: "u2", kind: "human", display_name: "Lan Anh" } }), direct_child_count: 0, labels: [] },
  { task: task("t2", "Hoàn tiền khách"), direct_child_count: 0, labels: [] },
];

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/members")) {
      return Promise.resolve({ members: [{ workspace_id: "ws1", user_id: "u2", role: "member", email: "lan@x.vn", display_name: "Hoàng Lan" }] });
    }
    if (path.endsWith("/tasks/table/rows")) {
      return Promise.resolve({ query_fingerprint: "f", group_key: null, parent_id: null, total: 2, rows, next_cursor: null });
    }
    if (path.includes("/projects")) return Promise.resolve({ projects: [], total: 0 });
    if (path.includes("/meetings")) return Promise.resolve({ meetings: [], total: 0 });
    if (path.includes("/documents")) return Promise.resolve({ documents: [], next_cursor: null });
    if (path.includes("/chat/rooms")) return Promise.resolve({ rooms: [] });
    return Promise.resolve({});
  });
});

function mount(kinds: AskUniObjectKind[] = ["task", "member"], query = "hoan") {
  const ref = createRef<AskUniObjectPickerHandle>();
  const onPick = vi.fn();
  const onDismiss = vi.fn();
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <AskUniObjectPicker ref={ref} wsId="ws1" query={query} kinds={kinds} onPick={onPick} onDismiss={onDismiss} />
      </FeatureFlagsProvider>,
    ),
  );
  const key = (k: string) => {
    let handled = false;
    act(() => {
      handled = ref.current!.onKeyDown(new KeyboardEvent("keydown", { key: k }));
    });
    return handled;
  };
  return { onPick, onDismiss, key };
}

describe("AskUniObjectPicker", () => {
  it("shows a task with its status and assignee, underlining the match", async () => {
    mount();
    const opt = await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    expect(within(opt).getByText("Đang làm")).toBeInTheDocument();
    expect(within(opt).getByText("Lan Anh")).toBeInTheDocument();
    expect(within(opt).getByText("Hoàn").tagName).toBe("U");
  });

  it("a kind tab keeps only that kind", async () => {
    mount();
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    fireEvent.click(screen.getByRole("tab", { name: "Người" }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(await screen.findByRole("option", { name: /g Lan/ })).toBeInTheDocument();
  });

  it("has no tab for a kind it was not given", async () => {
    mount(["task"]);
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    expect(screen.queryByRole("tab", { name: "Người" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Tất cả" })).toBeInTheDocument();
  });

  it("down then enter picks the second row; escape dismisses", async () => {
    const { onPick, onDismiss, key } = mount(["task"]);
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    const list = screen.getByRole("listbox");
    const first = list.getAttribute("aria-activedescendant");
    expect(key("ArrowDown")).toBe(true);
    expect(list.getAttribute("aria-activedescendant")).not.toBe(first);
    expect(screen.getByRole("option", { name: /Hoàn tiền khách/ })).toHaveAttribute("aria-selected", "true");
    expect(key("Enter")).toBe(true);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: "task", id: "t2", title: "Hoàn tiền khách" }));
    expect(key("Escape")).toBe(true);
    expect(onDismiss).toHaveBeenCalled();
  });

  it("left and right move between tabs and wrap", async () => {
    const { key } = mount();
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    expect(screen.getByRole("tab", { name: "Tất cả" })).toHaveAttribute("aria-selected", "true");
    key("ArrowLeft");
    expect(screen.getByRole("tab", { name: "Người" })).toHaveAttribute("aria-selected", "true");
    key("ArrowRight");
    expect(screen.getByRole("tab", { name: "Tất cả" })).toHaveAttribute("aria-selected", "true");
  });

  it("enter on an empty list does nothing and is not handled", async () => {
    requestMock.mockImplementation(() => Promise.resolve({ members: [], rows: [], total: 0 }));
    const { onPick, key } = mount(["task"], "zzz");
    expect(await screen.findByText("Không có kết quả")).toBeInTheDocument();
    expect(key("Enter")).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
  });
});
