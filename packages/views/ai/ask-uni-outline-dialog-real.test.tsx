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

describe("AskUniOutlineDialog with the real editor", () => {
  it.each(OUTLINES)("Save with no edit does not call onSave: %j", async (markdown) => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AskUniOutlineDialog open markdown={markdown} busy={false} onOpenChange={onOpenChange} onSave={onSave} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(document.querySelector(".ProseMirror[contenteditable='true']")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Lưu dàn ý" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
