import type { Editor, JSONContent } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { useAiPanelStore } from "@uniwork/core/ai";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { useAskModelChoice } from "@uniwork/core/ai/model-choice";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { AskUniComposer } from "./ask-uni-composer";
import { composerRoutes, user, workspace } from "./ask-uni-fixtures";

initI18n();

type Surface = HTMLElement & { editor: Editor };

/** The question box: the editor's contenteditable, which carries the editor instance. */
const box = () => screen.getByLabelText("Câu hỏi cho UNI") as Surface;
/** The first paragraph's inline nodes. */
const inline = (): JSONContent[] => box().editor.getJSON().content?.[0]?.content ?? [];
const cards = () => inline().filter((n) => n.type === "askUniMention");

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
  return { rerender: (streaming: boolean) => r.rerender(ui(streaming)), onSend, onStop };
}

/** Types at the caret the way ProseMirror receives typed text. */
function type(text: string) {
  const { editor } = box();
  act(() => {
    for (const char of text) {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (fn) =>
        fn(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  });
}

function paste(data: Record<string, string>) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: [], types: Object.keys(data), getData: (format: string) => data[format] ?? "" },
  });
  act(() => {
    box().dispatchEvent(event);
  });
}

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(box(), { key: k, ...init });

/** A picker row by its text: the underlined match splits the accessible name, so match the row's text instead. */
const option = (text: string) => screen.findByRole("option", { name: (_name, el) => el?.textContent?.includes(text) ?? false });

beforeEach(() => {
  resetAuthStoreForTests();
  requestMock.mockReset();
  requestMock.mockImplementation(composerRoutes);
  useAiPanelStore.setState({ conversationId: "c1", workspaceId: "ws1", pendingFocus: null, open: true, page: null, pageDismissed: null });
  useAskModelChoice.setState({ model: "", effort: "" });
});

describe("AskUniComposer", () => {
  it("holds the chips, the box and the buttons in one frame", async () => {
    mount();
    act(() => useAiPanelStore.getState().openWithFocus({ kind: "meeting", id: "m9" }));
    const chip = await screen.findByRole("button", { name: "Bỏ phạm vi Cuộc họp" });
    const frame = box().closest('[data-slot="ask-uni-composer-frame"]')!;
    expect(frame.className).toContain("rounded-2xl");
    // The frame lights up for the editor's focus, not for any button inside it.
    expect(frame.className).toContain("has-[.ProseMirror-focused]:border-ring");
    expect(frame.className).not.toContain("focus-within:");
    for (const el of [chip, screen.getByRole("button", { name: "Thêm phạm vi" }), screen.getByRole("button", { name: "Gửi" })]) {
      expect(frame).toContainElement(el);
    }
  });

  it("enter sends, shift-enter breaks the line, composing does not send", () => {
    const { onSend } = mount();
    type("Task nào quá hạn?");
    key("Enter", { shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(inline().map((n) => n.type)).toEqual(["text", "hardBreak"]);
    // Telex/VNI confirm a syllable with Enter; that must never send.
    fireEvent.compositionStart(box());
    key("Enter", { isComposing: true, keyCode: 229 });
    fireEvent.compositionEnd(box());
    key("Enter", { isComposing: true });
    key("Enter", { keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    // An IME Enter changes nothing: still one paragraph, the same text and break.
    expect(box().editor.getJSON().content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Task nào quá hạn?" }, { type: "hardBreak" }] },
    ]);
    key("Enter");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toMatchObject({ question: "Task nào quá hạn?", mentions: [], conversation_id: "c1", model: "", effort: "" });
    expect(box().editor.getText()).toBe("");
  });

  it("never sends an empty or blank question", () => {
    const { onSend } = mount();
    key("Enter");
    type("   ");
    key("Enter", { shiftKey: true });
    type(" ");
    key("Enter");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Gửi" })).toHaveAttribute("aria-disabled", "true");
  });

  it("stop replaces send while streaming and the box stays editable", () => {
    const { onStop } = mount({ streaming: true });
    expect(screen.queryByRole("button", { name: "Gửi" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dừng" }));
    expect(onStop).toHaveBeenCalled();
    expect(box()).toHaveAttribute("contenteditable", "true");
  });

  it("an @ pick becomes a card inside the sentence and is sent as a mention", async () => {
    const { onSend } = mount();
    type("Tóm tắt @hoan");
    await option("Hoàn thiện báo cáo");
    key("Enter");
    expect(inline()).toEqual([
      { type: "text", text: "Tóm tắt " },
      { type: "askUniMention", attrs: { kind: "task", id: "t3", label: "Hoàn thiện báo cáo" } },
      { type: "text", text: " " },
    ]);
    expect(box().editor.getText()).not.toContain("@hoan");
    expect(screen.queryByRole("listbox")).toBeNull();
    // The card lives in the text: there is no chip above the box for it.
    expect(screen.queryByRole("button", { name: /Hoàn thiện/ })).toBeNull();
    expect(await within(box()).findByLabelText("Task: Hoàn thiện báo cáo")).toBeInTheDocument();
    // A task card carries its live status label.
    expect(await within(box()).findByText("Cần làm")).toBeInTheDocument();
    type("giúp");
    key("Enter");
    expect(onSend.mock.calls[0]![0]).toMatchObject({ question: "Tóm tắt Hoàn thiện báo cáo giúp", mentions: [{ kind: "task", id: "t3" }] });
  });

  it("offers every kind in the @ picker and sends a member pick as a mention", async () => {
    const { onSend } = mount({ documents: true });
    type("Hỏi @La");
    const list = await screen.findByRole("listbox", { name: "Chọn đối tượng" });
    await option("Lan Anh");
    await option("Lập kế hoạch Q4");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Tất cả", "Task", "Tài liệu", "Cuộc họp", "Dự án", "Người", "Phòng chat"]);
    fireEvent.click(await option("Lan Anh"));
    expect(cards()).toEqual([{ type: "askUniMention", attrs: { kind: "member", id: "u2", label: "Lan Anh" } }]);
    key("Enter");
    expect(onSend.mock.calls[0]![0]).toMatchObject({ question: "Hỏi Lan Anh", mentions: [{ kind: "member", id: "u2" }] });
  });

  it("hides documents when the flag is off and picks with the arrows", async () => {
    const { onSend } = mount();
    type("@La");
    for (const text of ["Lập kế hoạch", "Họp tuần", "Website", "Lan Anh"]) await option(text);
    expect(screen.queryByRole("tab", { name: "Tài liệu" })).toBeNull();
    key("ArrowDown");
    key("Enter");
    expect(onSend).not.toHaveBeenCalled();
    expect(cards()).toEqual([{ type: "askUniMention", attrs: { kind: "meeting", id: "m1", label: "Họp tuần" } }]);
    key("Enter");
    expect(onSend.mock.calls[0]![0].mentions).toEqual([{ kind: "meeting", id: "m1" }]);
  });

  it("left switches the picker's tab only with the caret right after the @, and otherwise moves the caret", async () => {
    mount();
    type("@La");
    await option("Lập kế hoạch");
    // The caret ends the query: Left belongs to the caret.
    expect(key("ArrowLeft")).toBe(true);
    expect(screen.getByRole("tab", { name: "Tất cả" })).toHaveAttribute("aria-selected", "true");
    const { editor } = box();
    act(() => {
      editor.commands.setTextSelection(2);
    });
    expect(key("ArrowLeft")).toBe(false);
    expect(screen.getByRole("tab", { name: "Phòng chat" })).toHaveAttribute("aria-selected", "true");
    expect(editor.state.selection.from).toBe(2);
  });

  it("right switches the picker's tab only with the caret at the end of the @word, and otherwise moves the caret", async () => {
    mount();
    type("@Lan");
    const { editor } = box();
    // Between "La" and "n": Right belongs to the caret.
    act(() => {
      editor.commands.setTextSelection(editor.state.selection.from - 1);
    });
    await option("Lập kế hoạch");
    expect(key("ArrowRight")).toBe(true);
    expect(screen.getByRole("tab", { name: "Tất cả" })).toHaveAttribute("aria-selected", "true");
    act(() => {
      editor.commands.setTextSelection(editor.state.selection.from + 1);
    });
    expect(key("ArrowRight")).toBe(false);
    expect(screen.getByRole("tab", { name: "Task" })).toHaveAttribute("aria-selected", "true");
    expect(box().editor.getText()).toBe("@Lan");
  });

  it("a chat room pick is sent with kind room", async () => {
    // Chat rooms load only for a signed-in session.
    setSessionUser(user);
    const { onSend } = mount();
    type("@gen");
    fireEvent.click(await option("general"));
    expect(await within(box()).findByLabelText("Đoạn chat: general")).toBeInTheDocument();
    key("Enter");
    expect(onSend.mock.calls[0]![0].mentions).toEqual([{ kind: "room", id: "r1" }]);
  });

  it("one Backspace right after a card removes the whole card, but not while an IME composes", async () => {
    mount();
    type("Hỏi @La");
    fireEvent.click(await option("Lan Anh"));
    const { editor } = box();
    // The caret right after the card, before the space the pick added.
    act(() => {
      editor.commands.setTextSelection(editor.state.selection.from - 1);
    });
    fireEvent.compositionStart(box());
    key("Backspace", { keyCode: 229, isComposing: true });
    fireEvent.compositionEnd(box());
    key("Backspace", { keyCode: 229, isComposing: true });
    expect(cards()).toHaveLength(1);
    key("Backspace", { keyCode: 8 });
    expect(cards()).toEqual([]);
    expect(editor.getText()).toBe("Hỏi  ");
  });

  it("pastes plain text only, so pasted HTML never makes a card", () => {
    mount();
    paste({
      "text/plain": "Hỏi @Lan Anh\nngay",
      "text/html": '<span data-type="askUniMention" data-ask-uni-mention="member" kind="member" id="u2" label="Lan Anh">Lan Anh</span> <b>đậm</b>',
    });
    expect(inline()).toEqual([{ type: "text", text: "Hỏi @Lan Anh" }, { type: "hardBreak" }, { type: "text", text: "ngay" }]);
  });

  it("never parses HTML into a card, whatever path it comes in by", () => {
    mount();
    act(() => {
      box().editor.commands.setContent('<p><span data-type="askUniMention" data-ask-uni-mention="task" kind="task" id="t1" label="X">X</span> sau</p>');
    });
    expect(cards()).toEqual([]);
    expect(box().editor.getText()).toBe("X sau");
  });

  it("an @ inside a word does not open the picker", () => {
    mount();
    type("a@b");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(box()).toHaveAttribute("role", "textbox");
  });

  it("a pick adds a space after the card only when none follows", async () => {
    mount();
    type("Hỏi  ngay");
    const { editor } = box();
    act(() => {
      editor.commands.setTextSelection(5);
    });
    type("@La");
    fireEvent.click(await option("Lan Anh"));
    expect(inline()).toEqual([
      { type: "text", text: "Hỏi " },
      { type: "askUniMention", attrs: { kind: "member", id: "u2", label: "Lan Anh" } },
      { type: "text", text: " ngay" },
    ]);
  });

  it("at five cards an @ shows the limit instead of the picker", () => {
    mount();
    const card = (i: number) => ({ type: "askUniMention", attrs: { kind: "member", id: `u${i}`, label: `Nam${i}` } });
    act(() => {
      box().editor.commands.insertContent([0, 1, 2, 3, 4].flatMap((i) => [card(i), { type: "text", text: " " }]));
    });
    type("@Na");
    const notice = screen.getByText("Chỉ nhắc được tối đa 5 đối tượng trong một câu hỏi.");
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(box()).not.toHaveAttribute("aria-expanded");
    // Below the limit again, the same live region empties.
    type(" ");
    act(() => {
      box().editor.commands.deleteRange({ from: 1, to: 2 });
    });
    expect(cards()).toHaveLength(4);
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent("");
  });

  it("makes the box a combobox while the @ picker is open", async () => {
    mount();
    type("@La");
    // The count's live region is there before its first text.
    const count = within(screen.getByRole("tablist").parentElement!).getByRole("status");
    expect(count).toHaveTextContent("");
    const list = await screen.findByRole("listbox", { name: "Chọn đối tượng" });
    await option("Lập kế hoạch");
    await waitFor(() => expect(count).toHaveTextContent("4 kết quả"));
    expect(box()).toHaveAttribute("role", "combobox");
    expect(box()).toHaveAttribute("aria-expanded", "true");
    expect(box()).toHaveAttribute("aria-autocomplete", "list");
    expect(box().getAttribute("aria-controls")).toBe(list.id);
    expect(document.getElementById(box().getAttribute("aria-activedescendant") ?? "")).toBe(within(list).getAllByRole("option")[0]);
    key("Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box()).toHaveAttribute("role", "textbox");
    for (const a of ["aria-expanded", "aria-controls", "aria-activedescendant"]) expect(box()).not.toHaveAttribute(a);
  });

  it("keeps the empty text out of the listbox", async () => {
    mount();
    type("@zz");
    expect(await screen.findByText("Không có kết quả")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Enter on a settled empty list closes the picker and sends the text as it is", async () => {
    const { onSend } = mount();
    type("Hỏi @zz");
    await screen.findByText("Không có kết quả");
    key("Enter");
    expect(screen.queryByText("Không có kết quả")).toBeNull();
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toMatchObject({ question: "Hỏi @zz", mentions: [] });
  });

  it("after Escape Enter sends, and the next question's @ opens the picker again", async () => {
    const { onSend } = mount();
    type("@La");
    await option("Lan Anh");
    key("Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    key("Enter");
    expect(onSend).toHaveBeenCalledTimes(1);
    type("@La");
    expect(await screen.findByRole("listbox", { name: "Chọn đối tượng" })).toBeInTheDocument();
  });

  it("the picker closes when the box loses focus", async () => {
    mount();
    type("@La");
    await option("Lan Anh");
    expect(box()).toHaveAttribute("aria-expanded", "true");
    act(() => {
      box().blur();
    });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(box()).not.toHaveAttribute("aria-expanded");
    expect(box()).toHaveAttribute("role", "textbox");
  });

  it("Enter picks a visible option while another group still loads", async () => {
    requestMock.mockImplementation((path: string, init?: never) =>
      path.endsWith("/tasks/table/rows") ? new Promise(() => {}) : composerRoutes(path, init),
    );
    const { onSend } = mount();
    type("@La");
    await option("Lan Anh");
    const first = screen.getAllByRole("option")[0]!.textContent;
    key("Enter");
    expect(onSend).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(1);
    expect(first).toContain(cards()[0]!.attrs!.label);
  });

  it("with nothing visible while loading, Enter does nothing and Tab is not prevented", async () => {
    requestMock.mockImplementation((path: string, init?: never) =>
      path.endsWith("/tasks/table/rows") ? new Promise(() => {}) : composerRoutes(path, init),
    );
    const { onSend } = mount();
    type("@zz");
    // The task search has gone out after the typing settled, and never answers.
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => String(path).endsWith("/tasks/table/rows"))).toBe(true));
    expect(screen.queryByRole("option")).toBeNull();
    key("Enter");
    expect(onSend).not.toHaveBeenCalled();
    expect(key("Tab")).toBe(true);
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
    await screen.findByLabelText("Câu hỏi cho UNI");
    type("@La");
    await screen.findByRole("listbox", { name: "Chọn đối tượng" });
    key("Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("plus sets the scope as focus and the chip removes it", async () => {
    const { onSend } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Thêm phạm vi" }));
    fireEvent.click(await screen.findByRole("option", { name: /Website/ }));
    expect(screen.getByText("Dự án: Website")).toBeInTheDocument();
    type("Tiến độ?");
    key("Enter");
    expect(onSend.mock.calls[0]![0].focus).toEqual({ kind: "project", id: "p1" });
    // The scope stays for the next question until the chip is removed.
    fireEvent.click(screen.getByRole("button", { name: "Bỏ phạm vi Dự án: Website" }));
    type("Còn gì nữa?");
    key("Enter");
    expect(onSend.mock.calls[1]![0].focus).toBeUndefined();
  });

  it("plus finds a task and the picked task becomes the focus", async () => {
    const { onSend } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Thêm phạm vi" }));
    fireEvent.change(await screen.findByRole("combobox", { name: /Tìm/ }), { target: { value: "ori" } });
    expect(await screen.findByRole("tab", { name: "Task" })).toBeInTheDocument();
    const search = screen.getByRole("combobox", { name: /Tìm/ });
    await screen.findByRole("option", { name: /gami kế hoạch/ });
    const first = search.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).not.toBe(first);
    expect(search).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    fireEvent.click(await screen.findByRole("option", { name: /gami kế hoạch/ }));
    expect(screen.getByText("Task: Origami kế hoạch")).toBeInTheDocument();
    type("Còn gì?");
    key("Enter");
    expect(onSend.mock.calls[0]![0].focus).toEqual({ kind: "task", id: "t2" });
  });

  it("shows the focus chip an entry point asked for once, and it is removable", async () => {
    const { onSend } = mount();
    act(() => useAiPanelStore.getState().openWithFocus({ kind: "meeting", id: "m9" }));
    expect(await screen.findByRole("button", { name: "Bỏ phạm vi Cuộc họp" })).toBeInTheDocument();
    expect(useAiPanelStore.getState().pendingFocus).toBeNull();
    type("Tóm tắt");
    key("Enter");
    expect(onSend.mock.calls[0]![0].focus).toEqual({ kind: "meeting", id: "m9" });
    fireEvent.click(screen.getByRole("button", { name: "Bỏ phạm vi Cuộc họp" }));
    expect(screen.queryByRole("button", { name: "Bỏ phạm vi Cuộc họp" })).toBeNull();
  });

  it("names the entry point's object on its chip, and sends only its kind and id", async () => {
    const { onSend } = mount();
    act(() => useAiPanelStore.getState().openWithFocus({ kind: "task", id: "t2", label: "Nộp app lên store" }));
    expect(await screen.findByRole("button", { name: "Bỏ phạm vi Task: Nộp app lên store" })).toBeInTheDocument();
    type("Còn vướng gì?");
    key("Enter");
    expect(onSend.mock.calls[0]![0].focus).toEqual({ kind: "task", id: "t2" });
  });

  it("gives the chip remove button the coarse-pointer target and returns focus to the box", async () => {
    mount();
    act(() => useAiPanelStore.getState().openWithFocus({ kind: "meeting", id: "m9" }));
    const remove = await screen.findByRole("button", { name: "Bỏ phạm vi Cuộc họp" });
    expect(remove.className).toContain("pointer-coarse:min-h-11");
    remove.focus();
    fireEvent.click(remove);
    expect(box()).toHaveFocus();
  });

  it("sends the remembered model, but Auto when that model is no longer enabled", async () => {
    useAskModelChoice.setState({ model: "opus", effort: "high" });
    const { onSend } = mount();
    await screen.findByText("Opus dùng nhiều hạn mức token hơn các model khác.");
    type("Một");
    key("Enter");
    expect(onSend.mock.calls[0]![0]).toMatchObject({ model: "opus", effort: "high" });
    await act(async () => useAskModelChoice.setState({ model: "fable", effort: "" }));
    await waitFor(() => expect(screen.queryByText(/Opus dùng/)).toBeNull());
    type("Hai");
    key("Enter");
    expect(onSend.mock.calls[1]![0].model).toBe("");
  });

  it("takes the caret back when a turn ends only if nobody is typing elsewhere", () => {
    const outside = document.createElement("input");
    document.body.append(outside);
    const { rerender } = mount({ streaming: true });
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
    mount();
    act(() => useAiPanelStore.getState().openWithFocus({ kind: "meeting", id: "m9" }));
    await screen.findByRole("button", { name: "Bỏ phạm vi Cuộc họp" });
    fireEvent.click(screen.getByRole("button", { name: "Thêm phạm vi" }));
    fireEvent.click(await screen.findByRole("option", { name: /Website/ }));
    expect(screen.queryByRole("button", { name: "Bỏ phạm vi Cuộc họp" })).toBeNull();
    expect(screen.getByText("Dự án: Website")).toBeInTheDocument();
    await waitFor(() => expect(box()).toHaveFocus());
  });

  it("focuses the box on mount", () => {
    mount();
    expect(box()).toHaveFocus();
  });

  describe("the open page", () => {
    const setPage = () => act(() => useAiPanelStore.getState().setPage({ kind: "task", id: "t7", label: "Nộp app" }));

    it("shows as a chip with a kind placeholder, and is sent as the focus", () => {
      const { onSend } = mount();
      setPage();
      expect(screen.getByText("Trang này: Nộp app")).toBeInTheDocument();
      expect(box()).toHaveAttribute("aria-placeholder", "Hỏi về task này…");
      expect(box().querySelector("[data-placeholder]")).toHaveAttribute("data-placeholder", "Hỏi về task này…");
      type("Còn vướng gì?");
      key("Enter");
      expect(onSend.mock.calls[0]![0].focus).toEqual({ kind: "task", id: "t7" });
    });

    it("the x removes it, and the next question has no focus", () => {
      const { onSend } = mount();
      setPage();
      fireEvent.click(screen.getByRole("button", { name: "Bỏ phạm vi Trang này: Nộp app" }));
      expect(screen.queryByText("Trang này: Nộp app")).toBeNull();
      type("Hi");
      key("Enter");
      expect(onSend.mock.calls[0]![0].focus).toBeUndefined();
    });

    it("a hand-picked focus hides the page chip and wins; clearing it brings the page back", async () => {
      const { onSend } = mount();
      setPage();
      fireEvent.click(screen.getByRole("button", { name: "Thêm phạm vi" }));
      fireEvent.click(await screen.findByRole("option", { name: /Website/ }));
      expect(screen.queryByText("Trang này: Nộp app")).toBeNull();
      type("Hi");
      key("Enter");
      expect(onSend.mock.calls[0]![0].focus).toEqual({ kind: "project", id: "p1" });
      fireEvent.click(screen.getByRole("button", { name: "Bỏ phạm vi Dự án: Website" }));
      expect(screen.getByText("Trang này: Nộp app")).toBeInTheDocument();
    });
  });

});
