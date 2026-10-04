import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { createPptxCommandMap } from "./command-map";
import { PptxToolbar } from "./toolbar";
import { PPTX_TOOLBAR_TABS } from "./toolbar/tabs";

initI18n();
beforeEach(async () => { await setLocale("en"); });
afterEach(() => { window.innerWidth = 1024; });

const commands = createPptxCommandMap({ host: null });

describe("PptxToolbar", () => {
  it("renders the eight ribbon tabs with Home selected", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Home", "Insert", "Design", "Transitions", "Animations", "Slide Show", "Review", "View",
    ]);
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Insert" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tablist", { name: "PowerPoint commands" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
  });

  it("puts quick-access undo/redo at the far left of the tab row (C6)", () => {
    const onCommand = vi.fn();
    render(<PptxToolbar commands={commands} onCommand={onCommand} canUndo canRedo />);
    const row = document.querySelector("[data-pptx-tab-row]") as HTMLElement;
    const quick = row.querySelector("[data-pptx-quick-access]") as HTMLElement;
    const tabstrip = row.querySelector("[data-pptx-tabstrip]") as HTMLElement;
    expect(quick).not.toBeNull();
    // The quick-access cluster precedes the tab strip in DOM order.
    expect(quick.compareDocumentPosition(tabstrip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(quick.querySelector('[data-command="undo"]')).not.toBeNull();
    expect(quick.querySelector('[data-command="redo"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onCommand).toHaveBeenCalledWith("undo");
  });

  it("keeps no selection or position text in the ribbon (C6)", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    expect(screen.queryByText(/Selection \d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Slide \d+ of \d+/)).not.toBeInTheDocument();
  });

  it("puts the presenter view toggle and Find at the far right of the tab row (C6)", () => {
    const onCommand = vi.fn();
    render(<PptxToolbar commands={commands} onCommand={onCommand} />);
    const row = document.querySelector("[data-pptx-tab-row]") as HTMLElement;
    const trailing = row.querySelector("[data-pptx-tab-row-trailing]") as HTMLElement;
    const tabstrip = row.querySelector("[data-pptx-tabstrip]") as HTMLElement;
    expect(trailing).not.toBeNull();
    // Trailing cluster follows the tab strip in DOM order.
    expect(tabstrip.compareDocumentPosition(trailing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const presenter = screen.getByRole("button", { name: "Presenter" });
    const find = screen.getByRole("button", { name: "Find" });
    expect(presenter.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(find);
    expect(onCommand).toHaveBeenCalledWith("find");
  });

  it("exposes the presenter as an aria-pressed view toggle (C6)", () => {
    const view = render(<PptxToolbar commands={commands} onCommand={vi.fn()} presenterOpen={false} />);
    expect(screen.getByRole("button", { name: "Presenter" })).toHaveAttribute("aria-pressed", "false");
    view.rerender(<PptxToolbar commands={commands} onCommand={vi.fn()} presenterOpen />);
    expect(screen.getByRole("button", { name: "Presenter" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders exactly ONE command row, grouped, never a ragged second row (C7)", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    const rows = document.querySelectorAll("[data-pptx-command-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-pptx-command-row", "overflow");
    // Home has two groups: the file group and the primary editing group.
    expect(document.querySelectorAll("[data-pptx-tab-panel='home'] [data-pptx-group]")).toHaveLength(2);
  });

  it("switches the active tab's command groups on click", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Slide Show" }));
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("moves between tabs with the arrow keys and wraps", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    const home = screen.getByRole("tab", { name: "Home" });
    fireEvent.keyDown(home, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "View" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "View" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps a wave-B/C command disabled with its reason, exactly as the command map says", () => {
    const onCommand = vi.fn();
    render(<PptxToolbar commands={commands} onCommand={onCommand} />);
    const exportPdf = screen.getByRole("button", { name: "Export PDF" });
    expect(exportPdf).toBeDisabled();
    expect(exportPdf).toHaveAttribute("data-capability", "unavailable");
    fireEvent.click(exportPdf);
    expect(onCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Insert" }));
    expect(screen.getByRole("button", { name: "Tables" })).toBeDisabled();
  });

  it("renders the honestly empty Transitions tab as an empty note, not a fake control", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Transitions" }));
    expect(screen.getByText("This tab has no commands yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("disables Undo/Redo when the engine journal has no history", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} canUndo={false} canRedo={false} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(undo).toHaveAttribute("title", "No edit history yet.");
  });

  it("enables Undo/Redo when the handle reports both functions", () => {
    const onCommand = vi.fn();
    render(<PptxToolbar commands={commands} onCommand={onCommand} canUndo canRedo />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeEnabled();
    // A momentary action is not a toggle: no aria-pressed.
    expect(undo).not.toHaveAttribute("aria-pressed");
    fireEvent.click(undo);
    expect(onCommand).toHaveBeenCalledWith("undo");
  });

  it("turns the command row into one scrollable strip with the primary group first at phone widths (C12)", () => {
    window.innerWidth = 390;
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    const toolbar = document.querySelector("[data-pptx-toolbar]") as HTMLElement;
    expect(toolbar).toHaveAttribute("data-pptx-ribbon-width", "narrow");
    const row = document.querySelector("[data-pptx-command-row]") as HTMLElement;
    expect(row).toHaveAttribute("data-pptx-command-row", "scroll");
    // The editing (primary) group leads the file group on Home.
    const groups = row.querySelectorAll("[data-pptx-group]");
    expect(groups[0]).toHaveAttribute("data-pptx-group", "editing");
    expect(groups[1]).toHaveAttribute("data-pptx-group", "file");
    // No overflow menu in the scroll form.
    expect(document.querySelector("[data-pptx-overflow-trigger]")).toBeNull();
  });

  it("gives the active tab panel aria wiring and leaves the inactive tabs unpointed", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    const home = screen.getByRole("tab", { name: "Home" });
    const panel = document.getElementById(home.getAttribute("aria-controls")!);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("aria-labelledby", home.id);
    expect(screen.getByRole("tab", { name: "Insert" })).not.toHaveAttribute("aria-controls");
    expect(PPTX_TOOLBAR_TABS).toHaveLength(8);
  });
});