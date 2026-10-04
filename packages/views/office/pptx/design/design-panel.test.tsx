import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { installDesignPanelI18n } from "./install-design-i18n";
import type { ThemeEdit } from "@uniwork/office-engine/pptx";
import { PPTX_DESIGN_THEMES, type PptxDesignLayout } from "./design-model";
import { PptxDesignPanel, type PptxDesignPanelProps } from "./design-panel";

initI18n();
installDesignPanelI18n();
beforeEach(async () => { await setLocale("en"); });

const LAYOUTS: PptxDesignLayout[] = [
  { name: "Title Slide", path: "ppt/slideLayouts/slideLayout1.xml" },
  { name: "Blank", path: "ppt/slideLayouts/slideLayout2.xml" },
];

function renderPanel(overrides: Partial<PptxDesignPanelProps> = {}) {
  const onApplyEdit = vi.fn(async (_edit: ThemeEdit) => undefined);
  const onError = vi.fn();
  const view = render(
    <PptxDesignPanel
      onApplyEdit={onApplyEdit}
      onError={onError}
      slideCount={3}
      slideIndex={1}
      slideSize={{ cx: 12192000, cy: 6858000 }}
      layouts={LAYOUTS}
      activeLayoutPath="ppt/slideLayouts/slideLayout1.xml"
      activeThemeId="office"
      {...overrides}
    />,
  );
  return { view, onApplyEdit, onError };
}

const panel = () => document.querySelector("[data-pptx-design-panel]") as HTMLElement;

describe("PptxDesignPanel", () => {
  it("mounts the four Design controls in one labelled panel", () => {
    renderPanel();
    expect(panel()).toHaveAttribute("data-state", "ready");
    expect(screen.getByRole("region", { name: "Design" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Theme gallery" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Slide size presets" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Slide layouts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Format background" })).toBeInTheDocument();
  });

  it("applies a theme through the engine edit channel", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Apply theme Ember" }));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(1));
    const edit = onApplyEdit.mock.calls[0]![0];
    expect(edit.op).toBe("apply_theme");
    expect(edit).toEqual({ op: "apply_theme", name: "ember", colors: PPTX_DESIGN_THEMES.find((theme) => theme.id === "ember")?.colors, majorFont: "Trebuchet MS", minorFont: "Calibri" });
  });

  it("applies a slide size in EMU", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Standard (4:3)" }));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_slide_size", cxEmu: 9144000, cyEmu: 6858000 }));
  });

  it("applies a layout to the selected slide and resets to the master layout", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Use layout Blank" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_slide_layout", slideIndex: 1, layout: "ppt/slideLayouts/slideLayout2.xml" }),
    );
    fireEvent.click(screen.getByText("Reset to master layout"));
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_slide_layout", slideIndex: 1, reset: true }));
  });

  it("opens the background dialog and applies a solid fill to the current slide", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Format background" }));
    const dialog = screen.getByRole("dialog", { name: "Format background" });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("pptx-bg-solid-hex"), { target: { value: "#445566" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_background", slideIndex: 1, kind: "solid", color: "#445566" }),
    );
    // The dialog closes once the edit settles.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Format background" })).not.toBeInTheDocument());
  });

  it("fans apply-to-all out as one edit with an index array", async () => {
    const { onApplyEdit } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Format background" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply to all slides" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onApplyEdit).toHaveBeenCalledWith({ op: "set_background", slideIndex: [0, 1, 2], kind: "solid", color: "#FFFFFF" }),
    );
    expect(onApplyEdit).toHaveBeenCalledTimes(1);
  });

  it("shows the busy state while an edit is in flight and refuses a duplicate", async () => {
    let resolve!: () => void;
    const onApplyEdit = vi.fn((_edit: ThemeEdit) => new Promise<void>((done) => { resolve = done; }));
    renderPanel({ onApplyEdit });
    fireEvent.click(screen.getByRole("radio", { name: "Apply theme Ember" }));
    expect(screen.getByTestId("pptx-design-busy")).toHaveTextContent("Applying...");
    fireEvent.click(screen.getByRole("radio", { name: "Apply theme Forest" }));
    expect(onApplyEdit).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(panel()).toHaveAttribute("data-state", "ready"));
  });

  it("reports a refused edit as an error and keeps the document claim honest", async () => {
    const onApplyEdit = vi.fn(async () => { throw new Error("bad_theme_color"); });
    const onError = vi.fn();
    renderPanel({ onApplyEdit, onError });
    fireEvent.click(screen.getByRole("radio", { name: "Apply theme Ember" }));
    const alert = await screen.findByTestId("pptx-design-error");
    expect(alert).toHaveTextContent("The design change could not be applied");
    expect(alert).toHaveTextContent("bad_theme_color");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(panel()).toHaveAttribute("data-state", "ready");
  });

  it("keeps the background dialog open when its edit is refused", async () => {
    const onApplyEdit = vi.fn(async () => { throw new Error("bad_background"); });
    renderPanel({ onApplyEdit });
    fireEvent.click(screen.getByRole("button", { name: "Format background" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByTestId("pptx-design-error")).toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Format background" })).toBeInTheDocument();
  });

  it("renders the loading state as a busy status region", () => {
    renderPanel({ loading: true });
    expect(panel()).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status", { name: "Loading design options..." })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("renders the empty state for a deck with no slides", () => {
    renderPanel({ slideCount: 0, slideIndex: null });
    expect(panel()).toHaveAttribute("data-state", "empty");
    expect(panel()).toHaveTextContent("Open a presentation to change its design");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("disables every control and says so when no edit channel is bound", () => {
    renderPanel({ onApplyEdit: undefined });
    expect(screen.getByTestId("pptx-design-unbound")).toHaveTextContent("Design changes are not connected to this editor yet.");
    expect(screen.getByRole("radio", { name: "Apply theme Ember" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Format background" })).toBeDisabled();
  });

  it("disables every control in read-only mode", () => {
    const { onApplyEdit } = renderPanel({ disabled: true });
    fireEvent.click(screen.getByRole("radio", { name: "Apply theme Ember" }));
    expect(onApplyEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Apply theme Ember" })).toBeDisabled();
  });

  it("disables the background and layout controls when no slide is selected", () => {
    renderPanel({ slideIndex: null });
    expect(screen.getByRole("button", { name: "Format background" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Use layout Blank" })).toBeDisabled();
  });
});