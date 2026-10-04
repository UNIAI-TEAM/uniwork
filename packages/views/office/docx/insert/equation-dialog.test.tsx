import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EquationDialog, type EquationDialogProps } from "./equation-dialog";

function renderDialog(overrides: Partial<EquationDialogProps> = {}) {
  const props: EquationDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    onInsert: vi.fn(),
    ...overrides,
  };
  render(<EquationDialog {...props} />);
  return props;
}

describe("EquationDialog", () => {
  it("keeps Insert disabled until the LaTeX compiles, then submits it", () => {
    const props = renderDialog();
    expect(screen.getByTestId("docx-equation-insert")).toBeDisabled();
    expect(screen.getByTestId("docx-equation-preview")).not.toHaveTextContent("msup");

    fireEvent.change(screen.getByTestId("docx-equation-latex"), { target: { value: "x^2" } });
    expect(screen.getByTestId("docx-equation-insert")).toBeEnabled();
    expect(screen.getByTestId("docx-equation-preview").innerHTML).toContain("<msup>");

    fireEvent.click(screen.getByTestId("docx-equation-insert"));
    expect(props.onInsert).toHaveBeenCalledWith("x^2");
  });

  it("explains unsupported LaTeX and blocks the insert", () => {
    renderDialog();
    const field = screen.getByTestId("docx-equation-latex");
    fireEvent.change(field, { target: { value: "\\nope" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Không hỗ trợ LaTeX này.");
    expect(screen.getByTestId("docx-equation-insert")).toBeDisabled();
    expect(field).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(field, { target: { value: "\\frac{a}{b}" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("docx-equation-insert")).toBeEnabled();
  });

  it("submits on Enter from the field", () => {
    const props = renderDialog();
    const field = screen.getByTestId("docx-equation-latex");
    fireEvent.change(field, { target: { value: "a^2+b^2=c^2" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(props.onInsert).toHaveBeenCalledWith("a^2+b^2=c^2");
  });

  it("cancels on Escape and on the Cancel button", () => {
    const props = renderDialog();
    fireEvent.keyDown(screen.getByTestId("docx-equation-dialog"), { key: "Escape" });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(props.onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("keeps the field visible but blocks the insert on a read-only document", () => {
    const props = renderDialog({ readOnly: true });
    expect(screen.getByTestId("docx-equation-latex")).toBeDisabled();
    fireEvent.change(screen.getByTestId("docx-equation-latex"), { target: { value: "x^2" } });
    expect(screen.getByTestId("docx-equation-insert")).toBeDisabled();
    fireEvent.click(screen.getByTestId("docx-equation-insert"));
    expect(props.onInsert).not.toHaveBeenCalled();
  });
});
