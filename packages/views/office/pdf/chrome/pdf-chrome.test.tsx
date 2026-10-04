import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { PDF_COMMANDS } from "../pdf-command-map";
import type { PdfToolbarCommand } from "../toolbar";
import { PdfRibbonBar } from "./pdf-chrome";

const command = (id: PdfToolbarCommand["id"], label: string): PdfToolbarCommand => ({ id, label, onExecute: vi.fn() });

const pageCommands: readonly PdfToolbarCommand[] = [
  command(PDF_COMMANDS.insertPage, "Insert page"),
  command(PDF_COMMANDS.deletePage, "Delete page"),
  command(PDF_COMMANDS.rotatePage, "Rotate page"),
  command(PDF_COMMANDS.reorderPage, "Reorder page"),
  command(PDF_COMMANDS.extractPage, "Extract page"),
  command(PDF_COMMANDS.mergePages, "Merge pages"),
];

const undoRedo: readonly PdfToolbarCommand[] = [
  command(PDF_COMMANDS.undo, "Undo"),
  command(PDF_COMMANDS.redo, "Redo"),
  command(PDF_COMMANDS.save, "Save"),
];

const baseProps = {
  onTabChange: vi.fn(),
  onCommand: vi.fn(),
  findOpen: false,
  onFindToggle: vi.fn(),
};

beforeEach(async () => {
  await setLocale("en");
});

afterEach(() => {
  window.innerWidth = 1024;
});

describe("PdfRibbonBar", () => {
  it("keeps undo/redo at the far left and Find at the far right of the tab row", () => {
    window.innerWidth = 1400;
    render(<PdfRibbonBar {...baseProps} activeTab="home" commands={undoRedo} />);
    const tabRow = screen.getByTestId("pdf-chrome-tab-row");
    const controls = within(tabRow).getAllByRole("button");
    expect(controls[0]).toHaveAttribute("data-testid", "pdf-chrome-undo");
    expect(controls[1]).toHaveAttribute("data-testid", "pdf-chrome-redo");
    expect(controls[controls.length - 1]).toHaveAttribute("data-testid", "pdf-chrome-find");
    // The format tabs sit between the quick-access pair and Find.
    expect(within(tabRow).getByRole("tab", { name: "Home" })).toBeInTheDocument();
    expect(within(tabRow).getByRole("tab", { name: "View" })).toBeInTheDocument();
  });

  it("renders exactly one command row and no selection or position text", () => {
    window.innerWidth = 1400;
    render(<PdfRibbonBar {...baseProps} activeTab="pages" commands={pageCommands} />);
    expect(screen.getAllByTestId("pdf-chrome-command-row")).toHaveLength(1);
    expect(screen.getByRole("toolbar", { name: "PDF command groups" })).toBeInTheDocument();
    // Selection text belongs to the status bar, never the ribbon (C6).
    expect(screen.queryByTestId("pdf-selection")).not.toBeInTheDocument();
  });

  it("moves overflow groups into a trailing » menu at narrow widths instead of wrapping", () => {
    window.innerWidth = 500;
    render(<PdfRibbonBar {...baseProps} activeTab="pages" commands={pageCommands} />);
    expect(screen.getAllByTestId("pdf-chrome-command-row")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Insert page" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reorder page" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pdf-chrome-overflow"));
    expect(screen.getByRole("menuitem", { name: "Reorder page" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Merge pages" })).toBeInTheDocument();
  });

  it("leaves no empty command row on a tab without commands", () => {
    window.innerWidth = 1400;
    render(<PdfRibbonBar {...baseProps} activeTab="home" commands={undoRedo} />);
    expect(screen.queryByTestId("pdf-chrome-command-row")).not.toBeInTheDocument();
    // The tab row itself stays.
    expect(screen.getByTestId("pdf-chrome-tab-row")).toBeInTheDocument();
  });

  it("reports tab and Find changes upward", () => {
    window.innerWidth = 1400;
    const onTabChange = vi.fn();
    const onFindToggle = vi.fn();
    render(<PdfRibbonBar {...baseProps} onTabChange={onTabChange} onFindToggle={onFindToggle} activeTab="home" commands={undoRedo} />);
    fireEvent.click(screen.getByTestId("pdf-chrome-tab-pages"));
    expect(onTabChange).toHaveBeenCalledWith("pages");
    const find = screen.getByTestId("pdf-chrome-find");
    expect(find).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(find);
    expect(onFindToggle).toHaveBeenCalledOnce();
  });

  it("disables a quick undo whose command is disabled and does not execute it", () => {
    window.innerWidth = 1400;
    const onCommand = vi.fn();
    const onExecute = vi.fn();
    render(
      <PdfRibbonBar
        {...baseProps}
        onCommand={onCommand}
        activeTab="home"
        commands={[{ id: PDF_COMMANDS.undo, label: "Undo", disabled: true, onExecute }]}
      />,
    );
    const undo = screen.getByTestId("pdf-chrome-undo");
    expect(undo).toBeDisabled();
    fireEvent.click(undo);
    expect(onExecute).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("runs an enabled quick undo through onExecute then onCommand", () => {
    window.innerWidth = 1400;
    const onCommand = vi.fn();
    const onExecute = vi.fn();
    render(
      <PdfRibbonBar
        {...baseProps}
        onCommand={onCommand}
        activeTab="home"
        commands={[{ id: PDF_COMMANDS.undo, label: "Undo", onExecute }]}
      />,
    );
    fireEvent.click(screen.getByTestId("pdf-chrome-undo"));
    expect(onExecute).toHaveBeenCalledOnce();
    expect(onCommand).toHaveBeenCalledWith(PDF_COMMANDS.undo);
    expect(onExecute.mock.invocationCallOrder[0]).toBeLessThan(onCommand.mock.invocationCallOrder[0]!);
  });
});
