import { fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle, useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AskUniOutlineDialog } from "./ask-uni-outline-dialog";

initI18n();

// `ready` false is TipTap before it has an instance: no onReady, and getMarkdown answers "".
const gate = vi.hoisted(() => ({ ready: true }));

// A textarea stands in for the TipTap editor; getMarkdown reads the live value like the real one.
vi.mock("../editor", () => ({
  ContentEditor: forwardRef(function MockEditor({ defaultValue = "", ariaLabel, onReady }: { defaultValue?: string; ariaLabel?: string; onReady?: () => void }, ref) {
    const [value, setValue] = useState(defaultValue);
    useImperativeHandle(ref, () => ({ getMarkdown: () => (gate.ready ? value : "") }));
    useEffect(() => (gate.ready ? onReady?.() : undefined), []); // eslint-disable-line react-hooks/exhaustive-deps -- once, like the real editor's onReady
    return <textarea aria-label={ariaLabel} value={value} onChange={(e) => setValue(e.target.value)} />;
  }),
}));

function mount(over: Partial<ComponentProps<typeof AskUniOutlineDialog>> = {}) {
  const props = { open: true, markdown: "# Mở đầu", busy: false, onOpenChange: vi.fn(), onSave: vi.fn(), ...over };
  render(<AskUniOutlineDialog {...props} />);
  return props;
}

describe("AskUniOutlineDialog", () => {
  it("opens with the outline in the editor", () => {
    mount();
    expect(screen.getByRole("textbox", { name: "Dàn ý của tệp mới" })).toHaveValue("# Mở đầu");
  });

  it("saves the edited Markdown, trimmed", () => {
    const p = mount();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  # Mới\n\n- ý 1  \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu dàn ý" }));
    expect(p.onSave).toHaveBeenCalledWith("# Mới\n\n- ý 1");
  });

  it("only closes when nothing changed", () => {
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: "Lưu dàn ý" }));
    expect(p.onSave).not.toHaveBeenCalled();
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("never saves an empty outline before the editor is ready", () => {
    gate.ready = false;
    try {
      const p = mount();
      fireEvent.click(screen.getByRole("button", { name: "Lưu dàn ý" }));
      expect(p.onSave).not.toHaveBeenCalled();
      expect(p.onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      gate.ready = true;
    }
  });

  it("blocks Save while busy and shows the error", () => {
    const p = mount({ busy: true, error: "Không hợp lệ" });
    const save = screen.getByRole("button", { name: "Lưu dàn ý" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(save);
    expect(p.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Không hợp lệ");
  });
});
