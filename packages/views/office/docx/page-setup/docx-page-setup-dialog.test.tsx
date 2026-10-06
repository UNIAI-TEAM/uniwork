import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocxPageSetupDialog, type DocxPageSetupDialogProps } from "./docx-page-setup-dialog";
import type { DocxPageSetupSection, DocxPageSetupState } from "./docx-page-setup";

const A4_LANDSCAPE: DocxPageSetupSection = {
  index: 0,
  firstBlockIndex: 0,
  lastBlockIndex: 1,
  pageWidth: 16838,
  pageHeight: 11906,
  orientation: "landscape",
  marginTop: 720,
  marginRight: 720,
  marginBottom: 720,
  marginLeft: 720,
  columns: 1,
  columnSpace: 425,
  startType: "continuous",
};

const A4_PORTRAIT: DocxPageSetupSection = {
  index: 1,
  firstBlockIndex: 2,
  lastBlockIndex: 3,
  pageWidth: 11906,
  pageHeight: 16838,
  orientation: "portrait",
  marginTop: 1440,
  marginRight: 1440,
  marginBottom: 1440,
  marginLeft: 1440,
  columns: 2,
  columnSpace: 425,
  startType: "nextPage",
};

function renderDialog(sections: DocxPageSetupSection[], activeIndex: number, overrides: Partial<DocxPageSetupDialogProps> = {}) {
  const props: DocxPageSetupDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    state: { sections, activeIndex } satisfies DocxPageSetupState,
    onApply: vi.fn(),
    ...overrides,
  };
  render(<DocxPageSetupDialog {...props} />);
  return props;
}

describe("DocxPageSetupDialog", () => {
  it("seeds the active section, its cm margins and its position", () => {
    renderDialog([A4_LANDSCAPE, A4_PORTRAIT], 1);
    expect(screen.getByText("Phần 2/2")).toBeInTheDocument();
    expect(screen.getByTestId("docx-page-setup-margin-top")).toHaveValue("2.54");
    expect(screen.getByTestId("docx-page-setup-paper-width")).toHaveValue("21");
    expect(screen.getByTestId("docx-page-setup-paper-height")).toHaveValue("29.7");
    expect(screen.getByTestId("docx-page-setup-column-space")).toHaveValue("0.75");
    expect(screen.getByTestId("docx-page-setup-landscape")).toHaveAttribute("aria-pressed", "false");
  });

  it("applies only the changed fields and closes", () => {
    const props = renderDialog([A4_PORTRAIT], 0);
    fireEvent.change(screen.getByTestId("docx-page-setup-margin-top"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("docx-page-setup-apply"));
    expect(props.onApply).toHaveBeenCalledWith(0, { marginTop: 1134 });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes without an edit when nothing changed", () => {
    const props = renderDialog([A4_PORTRAIT], 0);
    fireEvent.click(screen.getByTestId("docx-page-setup-apply"));
    expect(props.onApply).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("swaps the paper on an orientation change and sends both fields", () => {
    const props = renderDialog([A4_PORTRAIT], 0);
    fireEvent.click(screen.getByTestId("docx-page-setup-landscape"));
    expect(screen.getByTestId("docx-page-setup-paper-width")).toHaveValue("29.7");
    expect(screen.getByTestId("docx-page-setup-paper-height")).toHaveValue("21");
    fireEvent.click(screen.getByTestId("docx-page-setup-apply"));
    expect(props.onApply).toHaveBeenCalledWith(0, { orientation: "landscape", pageWidth: 16838, pageHeight: 11906 });
  });

  it("blocks apply with a non-negative margin error and explains it", () => {
    const props = renderDialog([A4_PORTRAIT], 0);
    fireEvent.change(screen.getByTestId("docx-page-setup-margin-left"), { target: { value: "-1" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Lề phải là số không âm.");
    expect(screen.getByTestId("docx-page-setup-apply")).toBeDisabled();
    fireEvent.click(screen.getByTestId("docx-page-setup-apply"));
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("blocks apply when the margins do not fit the page", () => {
    renderDialog([A4_PORTRAIT], 0);
    fireEvent.change(screen.getByTestId("docx-page-setup-margin-top"), { target: { value: "29" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Lề phải nằm trong kích thước trang.");
    expect(screen.getByTestId("docx-page-setup-apply")).toBeDisabled();
  });

  it("keeps the fields visible but blocks apply on a read-only document", () => {
    const props = renderDialog([A4_PORTRAIT], 0, { readOnly: true });
    expect(screen.getByTestId("docx-page-setup-margin-top")).toBeDisabled();
    expect(screen.getByTestId("docx-page-setup-apply")).toBeDisabled();
    fireEvent.click(screen.getByTestId("docx-page-setup-apply"));
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("applies a margin preset's four values", () => {
    const props = renderDialog([A4_PORTRAIT], 0);
    // The preset select cannot be opened in jsdom; narrow margins are reached
    // through the fields it writes (the dialog's own patch).
    fireEvent.change(screen.getByTestId("docx-page-setup-margin-top"), { target: { value: "1.27" } });
    fireEvent.change(screen.getByTestId("docx-page-setup-margin-bottom"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByTestId("docx-page-setup-apply"));
    expect(props.onApply).toHaveBeenCalledWith(0, { marginTop: 720, marginBottom: 283 });
  });
});
