import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { TextEdit } from "@uniwork/office-engine/pptx";
import { pptxTextDictionary } from "./text-i18n";
import { PptxTextFormatPanel, type PptxTextFormatPanelProps } from "./pptx-text-format-panel";

// The panel carries its own keys; install them into the shared instance the way
// the serialized WIRE-MOUNT round will by merging the same entries into the
// locale files.
const instance = initI18n();
for (const locale of ["en", "vi"] as const) {
  instance.addResourceBundle(locale, "translation", pptxTextDictionary(locale), true, true);
}
beforeEach(async () => {
  await setLocale("en");
});

function renderPanel(overrides: Partial<PptxTextFormatPanelProps> = {}) {
  const onApplyEdit = vi.fn(async (_edit: TextEdit) => undefined);
  const onError = vi.fn();
  const element = (extra: Partial<PptxTextFormatPanelProps> = {}) => (
    <PptxTextFormatPanel
      onApplyEdit={onApplyEdit}
      onError={onError}
      slideIndex={1}
      selectedElementId="t1"
      selectedElementType="text"
      {...overrides}
      {...extra}
    />
  );
  const view = render(element());
  return {
    view,
    rerender: (extra: Partial<PptxTextFormatPanelProps> = {}) => view.rerender(element(extra)),
    onApplyEdit,
    onError,
  };
}

const panel = () => document.querySelector("[data-pptx-text-format-panel]") as HTMLElement;

describe("PptxTextFormatPanel", () => {
  it("renders every text-format control in one labelled panel", () => {
    renderPanel();
    expect(panel()).toHaveAttribute("data-state", "ready");
    expect(screen.getByRole("region", { name: "Text" })).toBeInTheDocument();
    for (const toggle of ["bold", "italic", "underline", "strike"]) {
      expect(screen.getByTestId("pptx-text-toggle-" + toggle)).toBeInTheDocument();
    }
    expect(screen.getByTestId("pptx-text-font-family")).toBeInTheDocument();
    expect(screen.getByTestId("pptx-text-font-size")).toBeInTheDocument();
    expect(screen.getByTestId("pptx-text-color")).toBeInTheDocument();
    expect(screen.getByTestId("pptx-text-highlight")).toBeInTheDocument();
    expect(screen.getByTestId("pptx-text-line-spacing")).toBeInTheDocument();
    for (const align of ["left", "center", "right", "justify"]) {
      expect(screen.getByRole("radio", { name: align === "left" ? "Align left" : align === "center" ? "Align center" : align === "right" ? "Align right" : "Justify" })).toBeInTheDocument();
    }
    for (const bullet of ["none", "char", "number"]) {
      expect(document.querySelector("[data-pptx-text-bullet='" + bullet + "']")).not.toBeNull();
    }
  });

  it("emits one set_font per character toggle on click", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByTestId("pptx-text-toggle-bold"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_font", slideIndex: 1, elementId: "t1", font: { bold: true } }),
    );
    fireEvent.click(screen.getByTestId("pptx-text-toggle-italic"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_font", slideIndex: 1, elementId: "t1", font: { italic: true } }),
    );
    fireEvent.click(screen.getByTestId("pptx-text-toggle-underline"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_font", slideIndex: 1, elementId: "t1", font: { underline: true } }),
    );
    fireEvent.click(screen.getByTestId("pptx-text-toggle-strike"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_font", slideIndex: 1, elementId: "t1", font: { strike: true } }),
    );
  });

  it("toggles a character style off again", async () => {
    const { onApplyEdit } = renderPanel({ bold: true });
    fireEvent.click(screen.getByTestId("pptx-text-toggle-bold"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_font", slideIndex: 1, elementId: "t1", font: { bold: false } }),
    );
  });

  it("emits one set_font for the font family from the field", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByTestId("pptx-text-font-family-custom"), { target: { value: "Georgia" } });
    fireEvent.click(screen.getByTestId("pptx-text-apply-font-family"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_font",
        slideIndex: 1,
        elementId: "t1",
        font: { fontFamily: "Georgia" },
      }),
    );
  });

  it("emits one set_font for the font size and disables on an out-of-range size", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByTestId("pptx-text-font-size-custom"), { target: { value: "28" } });
    fireEvent.click(screen.getByTestId("pptx-text-apply-size"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_font",
        slideIndex: 1,
        elementId: "t1",
        font: { fontSizePt: 28 },
      }),
    );
    fireEvent.change(screen.getByTestId("pptx-text-font-size-custom"), { target: { value: "0" } });
    expect(screen.getByTestId("pptx-text-apply-size")).toBeDisabled();
  });

  it("emits one set_font for the text colour", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByTestId("pptx-text-color"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByTestId("pptx-text-apply-color"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_font",
        slideIndex: 1,
        elementId: "t1",
        font: { color: "#FF0000" },
      }),
    );
  });

  it("keeps the highlight control disabled (no engine field carries it)", () => {
    const { onApplyEdit } = renderPanel();
    const highlight = screen.getByTestId("pptx-text-highlight");
    expect(highlight).toBeDisabled();
    fireEvent.click(highlight);
    expect(onApplyEdit).not.toHaveBeenCalled();
  });

  it("emits one set_paragraph_format per alignment", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Align center" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_paragraph_format",
        slideIndex: 1,
        elementId: "t1",
        format: { align: "center" },
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Justify" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_paragraph_format",
        slideIndex: 1,
        elementId: "t1",
        format: { align: "justify" },
      }),
    );
  });

  it("emits one set_paragraph_format per bullet choice", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(document.querySelector("[data-pptx-text-bullet='char']") as HTMLElement);
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_paragraph_format",
        slideIndex: 1,
        elementId: "t1",
        format: { bullet: "char" },
      }),
    );
    fireEvent.click(document.querySelector("[data-pptx-text-bullet='number']") as HTMLElement);
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_paragraph_format",
        slideIndex: 1,
        elementId: "t1",
        format: { bullet: "number" },
      }),
    );
  });

  it("emits one set_paragraph_format for line spacing", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByTestId("pptx-text-line-spacing-custom"), { target: { value: "150" } });
    fireEvent.click(screen.getByTestId("pptx-text-apply-spacing"));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "set_paragraph_format",
        slideIndex: 1,
        elementId: "t1",
        format: { lineSpacingPct: 150 },
      }),
    );
  });

  it("shows the empty state and disables every control when nothing is selected", () => {
    renderPanel({ selectedElementId: null });
    expect(panel()).toHaveAttribute("data-state", "empty");
    expect(screen.getByTestId("pptx-text-format-empty")).toHaveTextContent("Select a text box");
    expect(screen.getByTestId("pptx-text-toggle-bold")).toBeDisabled();
    expect(screen.getByTestId("pptx-text-apply-size")).toBeDisabled();
  });

  it("disables every control and says so when no edit channel is bound", () => {
    renderPanel({ onApplyEdit: undefined });
    expect(screen.getByTestId("pptx-text-format-unbound")).toHaveTextContent("not connected to this editor yet");
    expect(screen.getByTestId("pptx-text-toggle-bold")).toBeDisabled();
  });

  it("disables every control in read-only mode and explains why", () => {
    const { onApplyEdit } = renderPanel({ disabled: true });
    fireEvent.click(screen.getByTestId("pptx-text-toggle-bold"));
    expect(onApplyEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("pptx-text-format-unbound")).toHaveTextContent("read-only");
  });

  it("disables the controls on an element type the engine would refuse", () => {
    const { onApplyEdit } = renderPanel({ selectedElementType: "picture" });
    expect(screen.getByTestId("pptx-text-format-unbound")).toHaveTextContent("cannot hold formatted text");
    fireEvent.click(screen.getByTestId("pptx-text-toggle-bold"));
    expect(onApplyEdit).not.toHaveBeenCalled();
  });

  it("shows the busy state while an edit is in flight and refuses a duplicate", async () => {
    let resolve!: () => void;
    const onApplyEdit = vi.fn((_edit: TextEdit) => new Promise<void>((done) => { resolve = done; }));
    renderPanel({ onApplyEdit });
    fireEvent.click(screen.getByTestId("pptx-text-toggle-bold"));
    expect(screen.getByTestId("pptx-text-format-busy")).toHaveTextContent("Applying");
    fireEvent.click(screen.getByTestId("pptx-text-toggle-italic"));
    expect(onApplyEdit).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "ready"));
  });

  it("reports a refused edit as an error and keeps the document claim honest", async () => {
    const onApplyEdit = vi.fn(async () => { throw new Error("text_bad_color"); });
    const onError = vi.fn();
    renderPanel({ onApplyEdit, onError });
    fireEvent.click(screen.getByTestId("pptx-text-toggle-bold"));
    const alert = await screen.findByTestId("pptx-text-format-error");
    expect(alert).toHaveTextContent("could not be applied");
    expect(alert).toHaveTextContent("text_bad_color");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(panel()).toHaveAttribute("data-state", "ready");
  });

  it("renders the loading state as a busy status region", () => {
    renderPanel({ loading: true });
    expect(panel()).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status", { name: "Loading the text tools..." })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("pptx-text-toggle-bold")).toBeNull();
  });

  it("renders vi copy when the locale is Vietnamese", async () => {
    await setLocale("vi");
    renderPanel();
    expect(screen.getByRole("region", { name: "Văn bản" })).toBeInTheDocument();
    await setLocale("en");
  });
});
