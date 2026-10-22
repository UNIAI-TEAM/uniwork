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

function mount(kinds: AskUniObjectKind[] = ["task", "member"], query = "hoan", opts: { documents?: boolean; onActiveChange?: (id?: string) => void } = {}) {
  const ref = createRef<AskUniObjectPickerHandle>();
  const onPick = vi.fn();
  const onDismiss = vi.fn();
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: opts.documents ?? true } }));
  const ui = (q: string) =>
    wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <AskUniObjectPicker ref={ref} wsId="ws1" query={q} kinds={kinds} onPick={onPick} onDismiss={onDismiss} onActiveChange={opts.onActiveChange} />
      </FeatureFlagsProvider>,
    );
  const r = render(ui(query));
  const key = (k: string, init: KeyboardEventInit = {}, target?: HTMLElement) => {
    let handled = false;
    act(() => {
      const e = new KeyboardEvent("keydown", { key: k, ...init });
      if (target) Object.defineProperty(e, "target", { value: target });
      handled = ref.current!.onKeyDown(e);
    });
    return handled;
  };
  return { onPick, onDismiss, key, rerender: (q: string) => r.rerender(ui(q)) };
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

  it("keeps the active row in view when moving down", async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const { key } = mount(["task"]);
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    spy.mockClear();
    key("ArrowDown");
    expect(spy).toHaveBeenCalledWith({ block: "nearest" });
    // @ts-expect-error restore the jsdom default (no scrollIntoView)
    delete Element.prototype.scrollIntoView;
  });

  it("arrows switch tabs from an input only when the caret allows", async () => {
    const { key } = mount();
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    const input = document.createElement("input");
    input.value = "hoan";
    input.setSelectionRange(2, 2);
    expect(key("ArrowLeft", {}, input)).toBe(false);
    expect(screen.getByRole("tab", { name: "Tất cả" })).toHaveAttribute("aria-selected", "true");
    input.setSelectionRange(0, 0);
    expect(key("ArrowLeft", {}, input)).toBe(true);
    expect(screen.getByRole("tab", { name: "Người" })).toHaveAttribute("aria-selected", "true");
    input.setSelectionRange(4, 4);
    expect(key("ArrowRight", {}, input)).toBe(true);
    input.value = "";
    expect(key("ArrowRight", {}, input)).toBe(true);
  });

  it("reports the active option id for a host input", async () => {
    const ids: (string | undefined)[] = [];
    const { key } = mount(["task"], "hoan", { onActiveChange: (id) => ids.push(id) });
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    const before = ids.at(-1);
    expect(before).toBeTruthy();
    key("ArrowDown");
    expect(ids.at(-1)).not.toBe(before);
    expect(document.getElementById(ids.at(-1)!)).toHaveAttribute("aria-selected", "true");
  });

  it("has no Documents tab when the documents flag is off", async () => {
    mount(["task", "document"], "hoan", { documents: false });
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    expect(screen.queryByRole("tab", { name: "Tài liệu" })).toBeNull();
  });

  it("ignores keys while composing", async () => {
    const { onPick, key } = mount(["task"]);
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    expect(key("Enter", { isComposing: true })).toBe(false);
    expect(key("ArrowDown", { isComposing: true })).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: /Hoàn thiện báo cáo/ })).toHaveAttribute("aria-selected", "true");
  });

  it("up at the top wraps to the last row; tab picks the active row", async () => {
    const { onPick, key } = mount(["task"]);
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    key("ArrowUp");
    expect(screen.getByRole("option", { name: /Hoàn tiền khách/ })).toHaveAttribute("aria-selected", "true");
    expect(key("Tab")).toBe(true);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "t2" }));
  });

  it("a new query returns the highlight to the first row", async () => {
    const { key, rerender } = mount(["task"]);
    await screen.findByRole("option", { name: /Hoàn thiện báo cáo/ });
    key("ArrowDown");
    rerender("hoan t");
    await screen.findAllByText("Hoàn t");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });
});
