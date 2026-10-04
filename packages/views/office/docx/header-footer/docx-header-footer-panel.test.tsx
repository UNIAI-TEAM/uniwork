import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxHeaderFooter, DocxHfSlot } from "@uniwork/office-engine/docx";
import { DocxHeaderFooterPanel, type DocxHeaderFooterPanelProps } from "./docx-header-footer-panel";
import { emptyHeaderFooterState, type DocxHeaderFooterState, type DocxHfSlotState } from "./header-footer-state";

function makeState(
  partial: Partial<Record<DocxHfSlot, DocxHfSlotState>> = {},
  flags: Partial<Pick<DocxHeaderFooterState, "titlePg" | "evenAndOddHeaders">> = {},
): DocxHeaderFooterState {
  const base = emptyHeaderFooterState();
  return {
    slots: { ...base.slots, ...partial },
    titlePg: flags.titlePg ?? false,
    evenAndOddHeaders: flags.evenAndOddHeaders ?? false,
  };
}

function slot(value: DocxHeaderFooter | null, hasImages = false): DocxHfSlotState {
  return { value, hasImages };
}

function renderPanel(overrides: Partial<DocxHeaderFooterPanelProps> = {}) {
  const props: DocxHeaderFooterPanelProps = {
    state: makeState(),
    onSetSlot: vi.fn(),
    onSetTitlePg: vi.fn(),
    onSetEvenOdd: vi.fn(),
    ...overrides,
  };
  render(<DocxHeaderFooterPanel {...props} />);
  return props;
}

describe("DocxHeaderFooterPanel", () => {
  it("shows the six slots, marks which carry content and edits the selected one", () => {
    renderPanel({
      state: makeState({
        header: slot({ text: "Confidential" }),
        headerFirst: slot({ text: "Cover" }),
        footerEven: slot(null, true),
      }),
    });

    for (const id of ["header", "footer", "headerFirst", "footerFirst", "headerEven", "footerEven"]) {
      expect(screen.getByTestId(`docx-hf-slot-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("docx-hf-slot-header")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("docx-hf-slot-header")).toHaveAttribute("data-has-content", "true");
    expect(screen.getByTestId("docx-hf-slot-footer")).toHaveAttribute("data-has-content", "false");
    // An image-only slot still counts as content, though it has no text to edit.
    expect(screen.getByTestId("docx-hf-slot-footerEven")).toHaveAttribute("data-has-content", "true");
    expect(screen.getByTestId("docx-hf-text")).toHaveValue("Confidential");

    fireEvent.click(screen.getByTestId("docx-hf-slot-headerFirst"));
    expect(screen.getByTestId("docx-hf-slot-headerFirst")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("docx-hf-slot-header")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("docx-hf-text")).toHaveValue("Cover");
  });

  it("applies the edited text to the active slot only once it is dirty", () => {
    const props = renderPanel({ state: makeState({ header: slot({ text: "Confidential" }) }) });

    expect(screen.getByTestId("docx-hf-apply")).toBeDisabled();
    fireEvent.change(screen.getByTestId("docx-hf-text"), { target: { value: "Internal" } });
    expect(screen.getByTestId("docx-hf-apply")).toBeEnabled();
    fireEvent.click(screen.getByTestId("docx-hf-apply"));

    expect(props.onSetSlot).toHaveBeenCalledTimes(1);
    expect(props.onSetSlot).toHaveBeenCalledWith("header", expect.objectContaining({ text: "Internal" }));
    expect(props.onSetTitlePg).not.toHaveBeenCalled();
  });

  it("reverts an unapplied draft and drops it when the slot changes", () => {
    renderPanel({ state: makeState({ header: slot({ text: "Confidential" }), footer: slot({ text: "Page" }) }) });

    fireEvent.change(screen.getByTestId("docx-hf-text"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByTestId("docx-hf-revert"));
    expect(screen.getByTestId("docx-hf-text")).toHaveValue("Confidential");
    expect(screen.getByTestId("docx-hf-apply")).toBeDisabled();

    fireEvent.change(screen.getByTestId("docx-hf-text"), { target: { value: "Changed again" } });
    fireEvent.click(screen.getByTestId("docx-hf-slot-footer"));
    expect(screen.getByTestId("docx-hf-text")).toHaveValue("Page");
    fireEvent.click(screen.getByTestId("docx-hf-slot-header"));
    expect(screen.getByTestId("docx-hf-text")).toHaveValue("Confidential");
  });

  it("clears a slot through the set-slot callback, and only when it has content", () => {
    const props = renderPanel({ state: makeState({ header: slot({ text: "Confidential" }), footer: slot(null) }) });

    expect(screen.getByTestId("docx-hf-clear")).toBeEnabled();
    fireEvent.click(screen.getByTestId("docx-hf-clear"));
    expect(props.onSetSlot).toHaveBeenCalledWith("header", null);

    fireEvent.click(screen.getByTestId("docx-hf-slot-footer"));
    expect(screen.getByTestId("docx-hf-clear")).toBeDisabled();
    fireEvent.click(screen.getByTestId("docx-hf-clear"));
    expect(props.onSetSlot).toHaveBeenCalledTimes(1);
  });

  it("reflects and toggles the first-page and odd/even variant switches", () => {
    const props = renderPanel({ state: makeState({}, { titlePg: true, evenAndOddHeaders: false }) });

    expect(screen.getByTestId("docx-hf-title-pg")).toBeChecked();
    expect(screen.getByTestId("docx-hf-even-odd")).not.toBeChecked();

    fireEvent.click(screen.getByTestId("docx-hf-title-pg"));
    expect(props.onSetTitlePg).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId("docx-hf-even-odd"));
    expect(props.onSetEvenOdd).toHaveBeenCalledWith(true);
    expect(props.onSetSlot).not.toHaveBeenCalled();
  });

  it("previews the slot with the real strip renderer, live from the draft", () => {
    renderPanel({ state: makeState({ header: slot({ text: "Hello page \uE001" }) }) });

    const preview = screen.getByTestId("docx-header-footer-preview");
    expect(preview).toHaveTextContent("Hello page 1");

    fireEvent.change(screen.getByTestId("docx-hf-text"), { target: { value: "Goodbye" } });
    expect(screen.getByTestId("docx-header-footer-preview")).toHaveTextContent("Goodbye");
  });

  it("shows the empty preview state when the selected slot has no text", () => {
    renderPanel({ initialSlot: "footer", state: makeState({ footer: slot(null) }) });
    expect(screen.getByTestId("docx-hf-preview-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("docx-header-footer-preview")).not.toBeInTheDocument();
  });

  it("keeps viewing but disables every edit on a read-only document", () => {
    const props = renderPanel({
      readOnly: true,
      state: makeState({ header: slot({ text: "Confidential" }) }, { titlePg: true }),
    });

    expect(screen.getByTestId("docx-hf-text")).toBeDisabled();
    expect(screen.getByTestId("docx-hf-apply")).toBeDisabled();
    expect(screen.getByTestId("docx-hf-revert")).toBeDisabled();
    expect(screen.getByTestId("docx-hf-clear")).toBeDisabled();
    // Base UI Switch renders aria-disabled/data-disabled, not the native
    // `disabled` attribute (repo disabled-control contract, login-view.test.tsx);
    // the panel does block the toggle, so assert the real disabled surface.
    expect(screen.getByTestId("docx-hf-title-pg")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-hf-even-odd")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-hf-readonly")).toBeInTheDocument();
    expect(screen.getByTestId("docx-header-footer-preview")).toHaveTextContent("Confidential");

    fireEvent.click(screen.getByTestId("docx-hf-title-pg"));
    expect(props.onSetTitlePg).not.toHaveBeenCalled();
  });

  it("blocks edits while a save is in flight but keeps the preview", () => {
    const props = renderPanel({ saving: true, state: makeState({ header: slot({ text: "Confidential" }) }) });

    expect(screen.getByTestId("docx-hf-text")).toBeDisabled();
    expect(screen.getByTestId("docx-hf-clear")).toBeDisabled();
    expect(screen.getByTestId("docx-hf-title-pg")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-header-footer-preview")).toHaveTextContent("Confidential");
    expect(props.onSetSlot).not.toHaveBeenCalled();
  });
});
