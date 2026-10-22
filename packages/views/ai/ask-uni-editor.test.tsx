import type { Editor } from "@tiptap/core";
import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import { AskUniEditor, type AskUniEditorHandle } from "./ask-uni-editor";

initI18n();

const box = () => screen.getByLabelText("Câu hỏi cho UNI") as HTMLElement & { editor: Editor };

function mount(disabled: boolean) {
  const ref = createRef<AskUniEditorHandle>();
  const onSubmit = vi.fn();
  const onChange = vi.fn();
  const ui = (d: boolean) =>
    wrapWithNav(<AskUniEditor ref={ref} wsId="ws1" placeholder="Hỏi UNI" disabled={d} maxMentions={5} onSubmit={onSubmit} onChange={onChange} />);
  const r = render(ui(disabled));
  return { ref, onSubmit, onChange, rerender: (d: boolean) => r.rerender(ui(d)) };
}

describe("AskUniEditor", () => {
  it("disabled keeps the text readable but takes no typing and sends nothing", () => {
    const { ref, onSubmit, rerender } = mount(false);
    act(() => {
      box().editor.commands.insertContent("Tiến độ?");
    });
    rerender(true);
    expect(box()).toHaveAttribute("contenteditable", "false");
    expect(box()).toHaveAttribute("aria-disabled", "true");
    expect(box()).toHaveTextContent("Tiến độ?");
    expect(box().editor.isEditable).toBe(false);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(false);
    expect(box()).toHaveAttribute("contenteditable", "true");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith({ question: "Tiến độ?", mentions: [] });
    expect(ref.current?.isEmpty()).toBe(false);
  });

  it("clear empties the box and tells the host", () => {
    const { ref, onChange } = mount(false);
    expect(ref.current?.isEmpty()).toBe(true);
    act(() => {
      box().editor.commands.insertContent("Một");
    });
    expect(onChange).toHaveBeenLastCalledWith({ question: "Một", mentions: [] });
    act(() => ref.current?.clear());
    expect(ref.current?.isEmpty()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith({ question: "", mentions: [] });
    act(() => ref.current?.focus());
    expect(box()).toHaveFocus();
  });
});
