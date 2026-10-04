import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { HeaderFooterEdit } from "@uniwork/office-engine/pptx";
import { installHeaderFooterPanelI18n } from "./install-headerfooter-i18n";
import { PptxHeaderFooterPanel, type PptxHeaderFooterPanelProps } from "./pptx-headerfooter-panel";

initI18n();
installHeaderFooterPanelI18n();
beforeEach(async () => {
  await setLocale("en");
});

function renderPanel(overrides: Partial<PptxHeaderFooterPanelProps> = {}) {
  const onApplyEdit = vi.fn(async (_edit: HeaderFooterEdit) => undefined);
  const onError = vi.fn();
  const element = (extra: Partial<PptxHeaderFooterPanelProps> = {}) => (
    <PptxHeaderFooterPanel
      onApplyEdit={onApplyEdit}
      onError={onError}
      slideCount={3}
      settings={null}
      {...overrides}
      {...extra}
    />
  );
  const view = render(element());
  return {
    view,
    rerender: (extra: Partial<PptxHeaderFooterPanelProps> = {}) => view.rerender(element(extra)),
    onApplyEdit,
    onError,
  };
}

const panel = () => document.querySelector("[data-pptx-headerfooter-panel]") as HTMLElement;

describe("PptxHeaderFooterPanel", () => {
  it("mounts the labelled panel with every control", () => {
    renderPanel();
    expect(panel()).toHaveAttribute("data-state", "ready");
    expect(screen.getByRole("region", { name: "Header and footer" })).toBeInTheDocument();
    expect(screen.getByLabelText("Footer text")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Slide number" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Update automatically" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply to all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove all" })).toBeInTheDocument();
  });

  it("applies the footer, slide number and date through the engine edit channel", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByLabelText("Footer text"), { target: { value: "Confidential" } });
    fireEvent.click(screen.getByRole("switch", { name: "Slide number" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to all" }));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(1));
    expect(onApplyEdit.mock.calls[0]![0]).toEqual({
      op: "apply_header_footer",
      settings: { footer: "Confidential", slideNum: true, date: "2026-10-04" },
    });
  });

  it("carries the auto-date flag only with a real date", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "today" } });
    fireEvent.click(screen.getByRole("switch", { name: "Update automatically" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to all" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "apply_header_footer",
        settings: { footer: null, slideNum: false, date: "today", dateAuto: true },
      }),
    );
  });

  it("seeds the fields from the deck settings", () => {
    renderPanel({ settings: { footer: "Team", slideNum: true, date: "2026-01-01" } });
    expect(screen.getByLabelText("Footer text")).toHaveValue("Team");
    expect(screen.getByRole("switch", { name: "Slide number" })).toBeChecked();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-01-01");
  });

  it("explains an empty request instead of sending a no-op", () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Apply to all" }));
    expect(onApplyEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("pptx-headerfooter-notice")).toHaveTextContent(
      "Add a footer, a date or the slide number first.",
    );
  });

  it("clears every field with Remove all", async () => {
    const { onApplyEdit } = renderPanel({ settings: { footer: "old", slideNum: true, date: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({
        op: "apply_header_footer",
        settings: { footer: null, slideNum: false, date: null },
      }),
    );
    expect(screen.getByLabelText("Footer text")).toHaveValue("");
    expect(screen.getByRole("switch", { name: "Slide number" })).not.toBeChecked();
  });

  it("shows the busy state while an edit is in flight and refuses a duplicate", async () => {
    let resolve!: () => void;
    const onApplyEdit = vi.fn(
      (_edit: HeaderFooterEdit) =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    renderPanel({ onApplyEdit, settings: { footer: "old" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    expect(screen.getByTestId("pptx-headerfooter-busy")).toHaveTextContent("Applying...");
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    expect(onApplyEdit).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "ready"));
  });

  it("reports a refused edit and keeps the document claim honest", async () => {
    const onApplyEdit = vi.fn(async () => {
      throw new Error("bad_hf_settings");
    });
    const onError = vi.fn();
    renderPanel({ onApplyEdit, onError, settings: { footer: "old" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    const alert = await screen.findByTestId("pptx-headerfooter-error");
    expect(alert).toHaveTextContent("The header and footer could not be applied");
    expect(alert).toHaveTextContent("bad_hf_settings");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(panel()).toHaveAttribute("data-state", "ready");
  });

  it("renders the loading state as a busy status region", () => {
    renderPanel({ loading: true });
    expect(panel()).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status", { name: "Loading header and footer options..." })).toHaveAttribute("aria-busy", "true");
  });

  it("renders the empty state for a deck with no slides", () => {
    renderPanel({ slideCount: 0 });
    expect(panel()).toHaveAttribute("data-state", "empty");
    expect(panel()).toHaveTextContent("Open a presentation to add a header or footer");
  });

  it("disables every control and says so when no edit channel is bound", () => {
    renderPanel({ onApplyEdit: undefined });
    expect(screen.getByTestId("pptx-headerfooter-unbound")).toHaveTextContent(
      "Header and footer changes are not connected to this editor yet.",
    );
    expect(screen.getByRole("button", { name: "Apply to all" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Slide number" })).toBeDisabled();
  });

  it("disables every control in read-only mode and explains why", () => {
    const { onApplyEdit } = renderPanel({ disabled: true });
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    expect(onApplyEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("pptx-headerfooter-unbound")).toHaveTextContent("This presentation is read-only.");
  });
});