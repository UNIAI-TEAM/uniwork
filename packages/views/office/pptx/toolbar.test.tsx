import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { createPptxCommandMap } from "./command-map";
import { PptxToolbar } from "./toolbar";
import { PPTX_TOOLBAR_TABS } from "./toolbar/tabs";

initI18n();
beforeEach(async () => { await setLocale("en"); });

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
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the active tab's command groups and switches on click", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Slide Show" }));
    expect(screen.getByRole("button", { name: "Presenter" })).toBeInTheDocument();
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
    const tables = screen.getByRole("tab", { name: "Insert" });
    fireEvent.click(tables);
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
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    const reasons = screen.getAllByRole("tooltip").map((node) => node.textContent ?? "");
    expect(reasons).toContain("No edit history yet.");
  });

  it("enables Undo/Redo when the handle reports both functions", () => {
    const onCommand = vi.fn();
    render(<PptxToolbar commands={commands} onCommand={onCommand} canUndo canRedo />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(onCommand).toHaveBeenCalledWith("undo");
  });

  it("gives the tab panels aria wiring back to their tab", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    const home = screen.getByRole("tab", { name: "Home" });
    const panel = document.getElementById(home.getAttribute("aria-controls")!);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("aria-labelledby", home.id);
    expect(PPTX_TOOLBAR_TABS).toHaveLength(8);
  });
});
