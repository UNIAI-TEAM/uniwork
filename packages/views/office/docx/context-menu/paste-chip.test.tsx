import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocxPasteChip } from "./paste-chip";

describe("DocxPasteChip", () => {
  it("marks the current mode and reports the chosen one", () => {
    const onApply = vi.fn();
    render(<DocxPasteChip mode="source" onApply={onApply} onDismiss={vi.fn()} />);

    expect(screen.getByTestId("docx-paste-source")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("docx-paste-merge")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("docx-paste-text")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId("docx-paste-merge"));
    expect(onApply).toHaveBeenLastCalledWith("merge");
    fireEvent.click(screen.getByTestId("docx-paste-text"));
    expect(onApply).toHaveBeenLastCalledWith("text");
  });

  it("dismisses on Escape", () => {
    const onDismiss = vi.fn();
    render(<DocxPasteChip mode="source" onApply={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: "a" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on an outside pointer down but keeps presses inside", () => {
    const onDismiss = vi.fn();
    render(<DocxPasteChip mode="source" onApply={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.mouseDown(screen.getByTestId("docx-paste-source"));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
