import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AskUniOutlineDialog } from "./ask-uni-outline-dialog";

initI18n();

// No `../editor` mock here: the real TipTap editor must hand back what the server stored, or Save with no edit
// would send a spurious PATCH.
const OUTLINES = [
  "## Slide 1\n- Ý chính A\n- Ý chính B\n\n## Slide 2\n- Ý chính C",
  "## Slide 1\n* x\n* y",
];

const surface = () => document.querySelector(".ProseMirror[contenteditable='true']");
const ready = () => waitFor(() => expect(surface()).toBeTruthy());
const save = () => fireEvent.click(screen.getByRole("button", { name: "Lưu dàn ý" }));

function ui(open: boolean, markdown: string, onSave: () => void, onOpenChange: () => void) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <AskUniOutlineDialog open={open} markdown={markdown} busy={false} onOpenChange={onOpenChange} onSave={onSave} />
    </QueryClientProvider>
  );
}

describe("AskUniOutlineDialog with the real editor", () => {
  it.each(OUTLINES)("Save with no edit does not call onSave: %j", async (markdown) => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    render(ui(true, markdown, onSave, onOpenChange));
    await ready();
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("judges a reopened dialog against its new outline, not the first one", async () => {
    const A = "## A\n* un";
    const B = "## B\n* deux";
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    const view = render(ui(true, A, onSave, onOpenChange));
    await ready();
    view.rerender(ui(false, A, onSave, onOpenChange));
    await waitFor(() => expect(surface()).toBeNull());
    view.rerender(ui(true, B, onSave, onOpenChange));
    await ready();
    save();
    expect(onSave).not.toHaveBeenCalled();

    // Editing B back to A's text is a real edit and must be sent.
    // TipTap exposes its instance on the editor element.
    const el = surface() as (HTMLElement & { editor: { commands: { setContent: (c: string, o: object) => boolean } } }) | null;
    el?.editor.commands.setContent(A, { contentType: "markdown" });
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("## A\n\n- un"));
  });
});
