import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfTextMarkupTools } from "./text-markup-tools";

describe("PdfTextMarkupTools", () => {
  it("emits only text markup operations for a selected quad", () => {
    const onMarkup = vi.fn();
    render(<PdfTextMarkupTools selection={{ page: 2, quads: [[1, 2, 3, 4, 5, 6, 7, 8]] }} onMarkup={onMarkup} />);
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(onMarkup).toHaveBeenCalledWith({
      op: "add_markup",
      target: { page: 2, quads: [[1, 2, 3, 4, 5, 6, 7, 8]] },
      type: "highlight",
      color: [1, 0.85, 0],
    });
  });

  it("names every markup button: visible text, tooltip and accessible name agree", () => {
    render(<PdfTextMarkupTools selection={null} onMarkup={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.textContent).not.toBe("");
      expect(button).toHaveAttribute("title", button.textContent);
      expect(button).toHaveAccessibleName(button.textContent ?? "");
    }
    expect(new Set(buttons.map((button) => button.textContent)).size).toBe(3);
  });

  it("disables actions without a text selection", () => {
    const onMarkup = vi.fn();
    render(<PdfTextMarkupTools selection={null} onMarkup={onMarkup} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
