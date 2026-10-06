// T12 (UNI-939): the shared status-row view buttons and the plain-text position helpers.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfficeStatusActions } from "./office-status-bar";
import { textCaret, textFigures } from "./text-position";

describe("OfficeStatusActions", () => {
  it("renders named real buttons in a named group and runs the command", () => {
    const onClick = vi.fn();
    render(<OfficeStatusActions label="View" actions={[{ id: "fit", label: "Fit to width", icon: <i />, onClick }]} />);
    const group = screen.getByRole("group", { name: "View" });
    const button = screen.getByRole("button", { name: "Fit to width" });
    expect(group).toContainElement(button);
    expect(button).not.toHaveAttribute("aria-pressed");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("exposes a toggle state and keeps a disabled action focusable but inert", () => {
    const onNotes = vi.fn();
    const onFit = vi.fn();
    render(
      <OfficeStatusActions
        label="View"
        actions={[
          { id: "notes", label: "Notes", pressed: true, onClick: onNotes },
          { id: "fit", label: "Fit", icon: <i />, disabled: true, onClick: onFit },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Notes" })).toHaveAttribute("aria-pressed", "true");
    const fit = screen.getByRole("button", { name: "Fit" });
    expect(fit).toHaveAttribute("aria-disabled", "true");
    expect(fit).not.toBeDisabled();
    fireEvent.click(fit);
    expect(onFit).not.toHaveBeenCalled();
  });

  it("renders nothing without actions, so the row never carries an empty slot", () => {
    const { container } = render(<OfficeStatusActions label="View" actions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("text position helpers", () => {
  it("reports 1-based line and column and clamps the offset", () => {
    expect(textCaret("", 0)).toEqual({ line: 1, column: 1 });
    expect(textCaret("ab\ncde\nf", 0)).toEqual({ line: 1, column: 1 });
    expect(textCaret("ab\ncde\nf", 2)).toEqual({ line: 1, column: 3 });
    expect(textCaret("ab\ncde\nf", 3)).toEqual({ line: 2, column: 1 });
    expect(textCaret("ab\ncde\nf", 8)).toEqual({ line: 3, column: 2 });
    expect(textCaret("ab\ncde\nf", 99)).toEqual({ line: 3, column: 2 });
    expect(textCaret("ab", -5)).toEqual({ line: 1, column: 1 });
    expect(textCaret("ab", Number.NaN)).toEqual({ line: 1, column: 1 });
  });

  it("counts characters and lines, an empty source being one line", () => {
    expect(textFigures("")).toEqual({ characters: 0, lines: 1 });
    expect(textFigures("a\nbc\n")).toEqual({ characters: 5, lines: 3 });
  });
});
