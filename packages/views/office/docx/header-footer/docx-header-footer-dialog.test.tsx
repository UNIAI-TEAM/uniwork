import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocxHeaderFooterDialog, type DocxHeaderFooterDialogProps } from "./docx-header-footer-dialog";
import { emptyHeaderFooterState } from "./header-footer-state";

function renderDialog(overrides: Partial<DocxHeaderFooterDialogProps> = {}) {
  const props: DocxHeaderFooterDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    state: emptyHeaderFooterState(),
    onSetSlot: vi.fn(),
    onSetTitlePg: vi.fn(),
    onSetEvenOdd: vi.fn(),
    ...overrides,
  };
  render(<DocxHeaderFooterDialog {...props} />);
  return props;
}

describe("DocxHeaderFooterDialog", () => {
  it("renders the editing panel inside the dialog and closes on demand", () => {
    const props = renderDialog();

    expect(screen.getByTestId("docx-header-footer-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("docx-header-footer-panel")).toBeInTheDocument();
    expect(screen.getByTestId("docx-hf-slot-header")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("docx-header-footer-close"));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("passes slot edits from the panel through to the caller", () => {
    const props = renderDialog();

    fireEvent.change(screen.getByTestId("docx-hf-text"), { target: { value: "Confidential" } });
    fireEvent.click(screen.getByTestId("docx-hf-apply"));
    expect(props.onSetSlot).toHaveBeenCalledWith("header", expect.objectContaining({ text: "Confidential" }));
  });
});
