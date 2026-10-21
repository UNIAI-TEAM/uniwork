import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { useAiPanelStore } from "@uniwork/core/ai";
import { useAskModelChoice } from "@uniwork/core/ai/model-choice";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniComposer } from "./ask-uni-composer";
import { composerRoutes, user, workspace } from "./ask-uni-fixtures";

initI18n();

function mount(props: { streaming?: boolean; documents?: boolean } = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: props.documents ?? false } }));
  const ui = (streaming: boolean) =>
    wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <AskUniComposer onSend={onSend} onStop={onStop} streaming={streaming} />
        </WorkspaceProvider>
      </FeatureFlagsProvider>,
    );
  const r = render(ui(props.streaming ?? false));
  return { rerender: (streaming: boolean) => r.rerender(ui(streaming)), onSend, onStop, box: () => screen.getByLabelText("Câu hỏi cho UNI") as HTMLTextAreaElement };
}

function type(box: HTMLTextAreaElement, value: string) {
  fireEvent.change(box, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(composerRoutes);
  useAiPanelStore.setState({ conversationId: "c1", workspaceId: "ws1", pendingFocus: null, open: true });
  useAskModelChoice.setState({ model: "", effort: "" });
});

describe("AskUniComposer", () => {
  it("enter sends, shift-enter breaks, composing does not send", () => {
    const { onSend, box } = mount();
    type(box(), "Task nào quá hạn?");
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toMatchObject({ question: "Task nào quá hạn?", conversation_id: "c1", model: "", effort: "" });
    expect(box().value).toBe("");
  });

  it("never sends an empty or blank question", () => {
    const { onSend, box } = mount();
    fireEvent.keyDown(box(), { key: "Enter" });
    type(box(), "   \n ");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("stop replaces send while streaming and the box stays editable", () => {
    const { onStop, box } = mount({ streaming: true });
    expect(screen.queryByRole("button", { name: "Gửi" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dừng" }));
    expect(onStop).toHaveBeenCalled();
    expect(box()).not.toBeDisabled();
  });

  it("@ opens the mention picker and a member pick is sent as a mention", async () => {
    const { onSend, box } = mount({ documents: true });
    type(box(), "Hỏi @La");
    const list = await screen.findByRole("listbox", { name: "Gợi ý nhắc tới" });
    await within(list).findByText("Lan Anh");
    await within(list).findByText("Lập kế hoạch");
    await within(list).findByText("Lập kế hoạch Q4");
    for (const g of ["Người", "Task", "Tài liệu"]) expect(within(list).getByText(g)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("option", { name: /Lan Anh/ }));
    expect(box().value).toBe("Hỏi @Lan Anh ");
    expect(screen.getByRole("button", { name: "Bỏ Lan Anh" })).toBeInTheDocument();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend.mock.calls[0]![0].mentions).toEqual([{ kind: "member", id: "u2" }]);
  });

  it("hides documents when the flag is off and picks with the keyboard", async () => {
    const { onSend, box } = mount();
    type(box(), "@La");
    const list = await screen.findByRole("listbox", { name: "Gợi ý nhắc tới" });
    await within(list).findByText("Lập kế hoạch");
    expect(within(list).queryByText("Tài liệu")).toBeNull();
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe("@Lập kế hoạch ");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend.mock.calls[0]![0].mentions).toEqual([{ kind: "task", id: "t1" }]);
  });

  it("removing a chip removes the mention", async () => {
    const { onSend, box } = mount();
    type(box(), "@La");
    fireEvent.click(await screen.findByRole("option", { name: /Lan Anh/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bỏ Lan Anh" }));
    expect(screen.queryByRole("button", { name: "Bỏ Lan Anh" })).toBeNull();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend.mock.calls[0]![0].mentions).toEqual([]);
  });

  it("mentions stop at five", async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      workspace_id: "ws1", user_id: `u${i + 10}`, role: "member", email: `n${i}@x.vn`, display_name: `Nam${i}`,
    }));
    requestMock.mockImplementation((path: string, init?: never) =>
      path.endsWith("/members") ? Promise.resolve({ members: many }) : composerRoutes(path, init),
    );
    const { box } = mount();
    for (let i = 0; i < 6; i++) {
      type(box(), `${box().value}@Nam${i}`);
      fireEvent.click(await screen.findByRole("option", { name: new RegExp(`Nam${i}`) }));
    }
    expect(screen.getAllByRole("button", { name: /^Bỏ Nam/ })).toHaveLength(5);
    expect(screen.getByText("Chỉ nhắc được tối đa 5 đối tượng trong một câu hỏi.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bỏ Nam5" })).toBeNull();
  });

  it("plus sets the scope as focus and the chip removes it", async () => {
    const { onSend, box } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Thêm phạm vi" }));
    fireEvent.click(await screen.findByRole("button", { name: /Website/ }));
    expect(screen.getByText("Dự án: Website")).toBeInTheDocument();
    type(box(), "Tiến độ?");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend.mock.calls[0]![0].focus).toEqual({ kind: "project", id: "p1" });
    // The scope stays for the next question until the chip is removed.
    fireEvent.click(screen.getByRole("button", { name: "Bỏ phạm vi Dự án: Website" }));
    type(box(), "Còn gì nữa?");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend.mock.calls[1]![0].focus).toBeUndefined();
  });

  it("shows the focus chip an entry point asked for once, and it is removable", async () => {
    const { onSend, box } = mount();
    act(() => useAiPanelStore.getState().openWithFocus({ kind: "meeting", id: "m9" }));
    expect(await screen.findByRole("button", { name: "Bỏ phạm vi Cuộc họp" })).toBeInTheDocument();
    expect(useAiPanelStore.getState().pendingFocus).toBeNull();
    type(box(), "Tóm tắt");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend.mock.calls[0]![0].focus).toEqual({ kind: "meeting", id: "m9" });
    fireEvent.click(screen.getByRole("button", { name: "Bỏ phạm vi Cuộc họp" }));
    expect(screen.queryByRole("button", { name: "Bỏ phạm vi Cuộc họp" })).toBeNull();
  });

  it("sends the remembered model, but Auto when that model is no longer enabled", async () => {
    useAskModelChoice.setState({ model: "opus", effort: "high" });
    const { onSend, box } = mount();
    await screen.findByText("Opus dùng nhiều hạn mức token hơn các model khác.");
    type(box(), "Một");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend.mock.calls[0]![0]).toMatchObject({ model: "opus", effort: "high" });
    await act(async () => useAskModelChoice.setState({ model: "fable", effort: "" }));
    await waitFor(() => expect(screen.queryByText(/Opus dùng/)).toBeNull());
    type(box(), "Hai");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend.mock.calls[1]![0].model).toBe("");
  });

  it("takes the caret back when a turn ends only if nobody is typing elsewhere", () => {
    const outside = document.createElement("input");
    document.body.append(outside);
    const { rerender, box } = mount({ streaming: true });
    outside.focus();
    rerender(false);
    expect(outside).toHaveFocus();
    rerender(true);
    screen.getByRole("button", { name: /^Chọn model/ }).focus();
    rerender(false);
    expect(box()).toHaveFocus();
    rerender(true);
    outside.blur();
    rerender(false);
    expect(box()).toHaveFocus();
    outside.remove();
  });

  it("keeps + while a focus exists and a pick replaces it", async () => {
    const { box } = mount();
    act(() => useAiPanelStore.getState().openWithFocus({ kind: "meeting", id: "m9" }));
    await screen.findByRole("button", { name: "Bỏ phạm vi Cuộc họp" });
    fireEvent.click(screen.getByRole("button", { name: "Thêm phạm vi" }));
    fireEvent.click(await screen.findByRole("button", { name: /Website/ }));
    expect(screen.queryByRole("button", { name: "Bỏ phạm vi Cuộc họp" })).toBeNull();
    expect(screen.getByText("Dự án: Website")).toBeInTheDocument();
    await waitFor(() => expect(box()).toHaveFocus());
  });

  it("tells assistive tech about the picker and its result count", async () => {
    const { box } = mount();
    type(box(), "@La");
    const list = await screen.findByRole("listbox", { name: "Gợi ý nhắc tới" });
    await within(list).findByText("Lập kế hoạch");
    expect(box()).toHaveAttribute("role", "combobox");
    expect(box()).toHaveAttribute("aria-expanded", "true");
    expect(box()).toHaveAttribute("aria-autocomplete", "list");
    expect(box().getAttribute("aria-controls")).toBe(list.id);
    expect(document.getElementById(box().getAttribute("aria-activedescendant") ?? "")).toBe(within(list).getAllByRole("option")[0]);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("4 gợi ý"));
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(box()).not.toHaveAttribute("role");
  });

  it("keeps the empty text out of the listbox", async () => {
    const { box } = mount();
    type(box(), "@zz");
    expect(await screen.findAllByText("Không có kết quả")).toHaveLength(2);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("gives the chip remove button the coarse-pointer target and returns focus to the box", async () => {
    const { box } = mount();
    type(box(), "@La");
    fireEvent.click(await screen.findByRole("option", { name: /Lan Anh/ }));
    const remove = screen.getByRole("button", { name: "Bỏ Lan Anh" });
    expect(remove.className).toContain("pointer-coarse:min-h-11");
    fireEvent.click(remove);
    expect(box()).toHaveFocus();
  });

  it("opens the picker again for an @ in the next question after Escape dismissed one", async () => {
    const { onSend, box } = mount();
    type(box(), "@La");
    await screen.findByRole("listbox", { name: "Gợi ý nhắc tới" });
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    type(box(), "@La");
    expect(await screen.findByRole("listbox", { name: "Gợi ý nhắc tới" })).toBeInTheDocument();
  });

  it("Enter picks a visible option while another group still loads", async () => {
    requestMock.mockImplementation((path: string, init?: never) =>
      path.endsWith("/tasks/table/rows") ? new Promise(() => {}) : composerRoutes(path, init),
    );
    const { onSend, box } = mount();
    type(box(), "@La");
    await screen.findByRole("option", { name: "Lan Anh" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe("@Lan Anh ");
  });

  it("with nothing visible while loading, Enter does nothing and Tab is not prevented", async () => {
    requestMock.mockImplementation((path: string, init?: never) =>
      path.endsWith("/tasks/table/rows") ? new Promise(() => {}) : composerRoutes(path, init),
    );
    const { onSend, box } = mount();
    type(box(), "@zz");
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("option")).toBeNull();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(box(), { key: "Tab" })).toBe(true);
  });

  it("sends on Enter when the open picker settled with no results", async () => {
    const { onSend, box } = mount();
    type(box(), "@zz");
    await screen.findAllByText("Không có kết quả");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("Escape that closes the picker does not close a Sheet around the panel", async () => {
    const onOpenChange = vi.fn();
    const service = new FeatureFlagService(new StaticProvider({}));
    render(
      wrapWithNav(
        <FeatureFlagsProvider service={service}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <Sheet open onOpenChange={onOpenChange}>
              <SheetContent side="right">
                <SheetTitle>UNI</SheetTitle>
                <AskUniComposer onSend={vi.fn()} onStop={vi.fn()} streaming={false} />
              </SheetContent>
            </Sheet>
          </WorkspaceProvider>
        </FeatureFlagsProvider>,
      ),
    );
    const box = (await screen.findByLabelText("Câu hỏi cho UNI")) as HTMLTextAreaElement;
    type(box, "@La");
    await screen.findByRole("listbox", { name: "Gợi ý nhắc tới" });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("focuses the box on mount", () => {
    const { box } = mount();
    expect(box()).toHaveFocus();
  });
});
