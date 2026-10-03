// B6 dialog tests: seed from the read state, one Apply per changed field set,
// refusal feedback and the read-only lock.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocxPageDecorDialog, type DocxPageDecorDialogProps } from "./docx-page-decor-dialog";
import type { DocxPageDecorView } from "./docx-page-decor";

function fixtureView(overrides: Partial<DocxPageDecorView> = {}): DocxPageDecorView {
  return {
    pageColor: null,
    watermarkText: "DRAFT",
    hasPictureWatermark: false,
    themeFonts: null,
    themeColors: null,
    sections: [
      { index: 0, firstBlockIndex: 0, lastBlockIndex: 1, borders: null },
      { index: 1, firstBlockIndex: 2, lastBlockIndex: 3, borders: { style: "double", widthEighths: 8, spacePt: 16, offsetFrom: "page" } },
    ],
    activeIndex: 0,
    ...overrides,
  };
}

function renderDialog(view: DocxPageDecorView, overrides: Partial<DocxPageDecorDialogProps> = {}) {
  const props: DocxPageDecorDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    state: view,
    onApply: vi.fn(),
    ...overrides,
  };
  render(<DocxPageDecorDialog {...props} />);
  return props;
}

describe("DocxPageDecorDialog", () => {
  it("seeds the watermark, the active section and closes without an edit", () => {
    const props = renderDialog(fixtureView());
    expect(screen.getByText("Trang trí trang")).toBeInTheDocument();
    expect(screen.getByText("Mục 1/2")).toBeInTheDocument();
    expect(screen.getByTestId("docx-page-decor-watermark-text")).toHaveValue("DRAFT");
    fireEvent.click(screen.getByTestId("docx-page-decor-apply"));
    expect(props.onApply).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("applies a watermark preset as a text watermark op", () => {
    const props = renderDialog(fixtureView());
    fireEvent.click(screen.getByTestId("docx-page-decor-watermark-preset-confidential"));
    fireEvent.click(screen.getByTestId("docx-page-decor-apply"));
    expect(props.onApply).toHaveBeenCalledWith([
      { op: "set_watermark", watermark: { text: "BẢO MẬT", opacity: 0.5, diagonal: true } },
    ]);
  });

  it("removes the watermark through the explicit action", () => {
    const props = renderDialog(fixtureView());
    fireEvent.click(screen.getByTestId("docx-page-decor-watermark-remove"));
    fireEvent.click(screen.getByTestId("docx-page-decor-apply"));
    expect(props.onApply).toHaveBeenCalledWith([{ op: "set_watermark", watermark: null }]);
  });

  it("applies a page colour swatch from the colour tab", () => {
    const props = renderDialog(fixtureView());
    fireEvent.click(screen.getByTestId("docx-page-decor-tab-color"));
    fireEvent.click(screen.getByTestId("docx-page-decor-color-lightBlue"));
    fireEvent.click(screen.getByTestId("docx-page-decor-apply"));
    expect(props.onApply).toHaveBeenCalledWith([{ op: "set_page_color", color: "E8F1FB" }]);
  });

  it("blocks apply on a malformed custom colour and explains it", () => {
    const props = renderDialog(fixtureView());
    fireEvent.click(screen.getByTestId("docx-page-decor-tab-color"));
    fireEvent.change(screen.getByTestId("docx-page-decor-color-custom"), { target: { value: "nope" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Màu phải là mã hex 6 ký tự.");
    expect(screen.getByTestId("docx-page-decor-apply")).toBeDisabled();
    fireEvent.click(screen.getByTestId("docx-page-decor-apply"));
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("enables the border box on the section at the cursor with the panel defaults", () => {
    const props = renderDialog(fixtureView());
    fireEvent.click(screen.getByTestId("docx-page-decor-tab-borders"));
    fireEvent.click(screen.getByTestId("docx-page-decor-border-toggle"));
    fireEvent.click(screen.getByTestId("docx-page-decor-apply"));
    expect(props.onApply).toHaveBeenCalledWith([
      { op: "set_page_borders", sectionIndex: 0, borders: { style: "single", widthEighths: 4, spacePt: 24, offsetFrom: "page" } },
    ]);
  });

  it("applies a theme preset as a font pair plus the colour slots", () => {
    const props = renderDialog(fixtureView());
    fireEvent.click(screen.getByTestId("docx-page-decor-tab-theme"));
    fireEvent.click(screen.getByTestId("docx-page-decor-theme-preset-facet"));
    fireEvent.click(screen.getByTestId("docx-page-decor-apply"));
    expect(props.onApply).toHaveBeenCalledWith([
      { op: "set_theme_fonts", fonts: { major: "Trebuchet MS", minor: "Trebuchet MS", eastAsia: "微软雅黑" } },
      {
        op: "set_theme_colors",
        colors: { dk2: "3E3D2D", lt2: "E1DFDD", accent1: "90C226", accent2: "54A021", accent3: "E6B91E", accent4: "E76618", accent5: "C42F1A", accent6: "918655" },
      },
    ]);
  });

  it("keeps the fields visible but blocks apply on a read-only document", () => {
    const props = renderDialog(fixtureView(), { readOnly: true });
    expect(screen.getByTestId("docx-page-decor-watermark-text")).toBeDisabled();
    expect(screen.getByTestId("docx-page-decor-apply")).toBeDisabled();
    fireEvent.click(screen.getByTestId("docx-page-decor-apply"));
    expect(props.onApply).not.toHaveBeenCalled();
  });
});
