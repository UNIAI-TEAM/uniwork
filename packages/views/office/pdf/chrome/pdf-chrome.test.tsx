import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import { PDF_COMMANDS } from "../pdf-command-map";
import type { PdfToolbarCommand } from "../toolbar";
import { PdfRibbonBar } from "./pdf-chrome";
import { createPdfRibbonTabs, PDF_RIBBON_SCOPE } from "./pdf-ribbon";

const command = (id: PdfToolbarCommand["id"], label: string, disabled?: boolean): PdfToolbarCommand => ({
  id,
  label,
  disabled,
  onExecute: vi.fn(),
});

const annotateCommands: readonly PdfToolbarCommand[] = [
  command(PDF_COMMANDS.annotations, "Annotations"),
  command(PDF_COMMANDS.highlight, "Highlight"),
  command(PDF_COMMANDS.note, "Note"),
  command(PDF_COMMANDS.stamp, "Stamp"),
  command(PDF_COMMANDS.forms, "Fill form"),
];

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
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
  await setLocale("en");
});

afterEach(() => {
  window.innerWidth = 1024;
});

describe("createPdfRibbonTabs", () => {
  it("maps the five PDF tabs in order with their labels", () => {
    const tabs = createPdfRibbonTabs(annotateCommands);
    expect(tabs.map((tab) => tab.id)).toEqual(["home", "annotate", "edit", "pages", "view"]);
    expect(tabs.map((tab) => tab.labelKey)).toEqual([
      "office.pdf.chrome.tabs.home",
      "office.pdf.chrome.tabs.annotate",
      "office.pdf.chrome.tabs.edit",
      "office.pdf.chrome.tabs.pages",
      "office.pdf.chrome.tabs.view",
    ]);
  });

  it("keeps the command-map groups and drops the ones with no present command", () => {
    const tabs = createPdfRibbonTabs(pageCommands);
    const annotate = tabs.find((tab) => tab.id === "annotate");
    expect(annotate?.groups).toEqual([]);
    const pages = tabs.find((tab) => tab.id === "pages");
    expect(pages?.groups.map((group) => group.id)).toEqual(["pages", "pageOps"]);
    expect(pages?.groups.map((group) => group.labelKey)).toEqual(["office.pdf.pages.title", "office.pdf.pageOps.title"]);
    expect(pages?.groups[0]?.items.map((item) => item.id)).toEqual(["insert-page", "delete-page", "rotate-page"]);
    expect(pages?.groups[1]?.items.map((item) => item.id)).toEqual(["reorder-page", "extract-page", "merge-pages"]);
    expect(tabs.find((tab) => tab.id === "home")?.groups).toEqual([]);
    expect(tabs.find((tab) => tab.id === "view")?.groups).toEqual([]);
  });

  it("renders the first item of a group large and the rest small", () => {
    const pages = createPdfRibbonTabs(pageCommands).find((tab) => tab.id === "pages");
    expect(pages?.groups[0]?.items.map((item) => item.size)).toEqual(["large", "small", "small"]);
  });

  it("gives the first group of a tab the highest priority so it collapses last", () => {
    const annotate = createPdfRibbonTabs(annotateCommands).find((tab) => tab.id === "annotate");
    expect(annotate?.groups.map((group) => group.id)).toEqual(["markups", "forms"]);
    const [first, second] = annotate?.groups ?? [];
    expect(first?.priority).toBeGreaterThan(second?.priority ?? 0);
  });

  it("carries every item's disabled flag and label key onto the ribbon item", () => {
    const tabs = createPdfRibbonTabs([command(PDF_COMMANDS.highlight, "Highlight", true)]);
    const item = tabs.find((tab) => tab.id === "annotate")?.groups[0]?.items[0];
    expect(item?.id).toBe("highlight");
    expect(item?.labelKey).toBe("office.pdf.commands.highlight");
    expect(item?.disabled).toBe(true);
  });

  it("runs a command through onExecute then onCommand", () => {
    const onCommand = vi.fn();
    const run = vi.fn();
    const tabs = createPdfRibbonTabs([{ id: PDF_COMMANDS.highlight, label: "Highlight", onExecute: run }], onCommand);
    const item = tabs.find((tab) => tab.id === "annotate")?.groups[0]?.items[0];
    if (item?.kind === "button") item.onExecute();
    expect(run).toHaveBeenCalledOnce();
    expect(onCommand).toHaveBeenCalledWith(PDF_COMMANDS.highlight);
    expect(run.mock.invocationCallOrder[0]).toBeLessThan(onCommand.mock.invocationCallOrder[0]!);
  });
});

describe("PdfRibbonBar", () => {
  it("renders the shared ribbon: quick undo/redo left, the five tabs, Find right", () => {
    render(<PdfRibbonBar {...baseProps} activeTab="home" commands={undoRedo} />);
    expect(screen.getByTestId("pdf-ribbon-bar")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "PDF editing commands" })).toHaveAttribute("data-office-ribbon", PDF_RIBBON_SCOPE);

    const tabRow = document.querySelector("[data-ribbon-tab-row]") as HTMLElement;
    const tablist = within(tabRow).getByRole("tablist");
    expect(within(tablist).getAllByRole("tab").map((tab) => tab.dataset.ribbonTab)).toEqual([
      "home",
      "annotate",
      "edit",
      "pages",
      "view",
    ]);
    // The chrome re-exposes the shared ribbon's tab buttons under the legacy
    // pdf-chrome-tab-<id> ids the consumers click, and the body as the command row.
    expect(screen.getByTestId("pdf-chrome-tab-pages")).toHaveAttribute("data-ribbon-tab", "pages");
    expect(screen.getByTestId("pdf-chrome-command-row")).toHaveAttribute("data-ribbon-body", "");

    const quickAccess = within(tabRow).getByRole("toolbar", { name: "Quick access" });
    expect(within(quickAccess).getByTestId("pdf-chrome-undo")).toBeInTheDocument();
    expect(within(quickAccess).getByTestId("pdf-chrome-redo")).toBeInTheDocument();

    const trailing = tabRow.querySelector("[data-ribbon-trailing]") as HTMLElement;
    expect(within(trailing).getByTestId("pdf-chrome-find")).toBeInTheDocument();
  });

  it("renders the active tab's labelled groups and items through the shared ribbon", () => {
    render(<PdfRibbonBar {...baseProps} activeTab="annotate" commands={annotateCommands} />);
    const groupIds = Array.from(document.querySelectorAll("[data-ribbon-group]")).map((node) => node.getAttribute("data-ribbon-group"));
    expect(groupIds).toEqual(["markups", "forms"]);
    const markups = document.querySelector("[data-ribbon-group='markups']") as HTMLElement;
    expect(markups).toHaveAttribute("aria-label", "Text markup tools");
    // The first present command of a group renders large, the rest small.
    expect(markups.querySelector("[data-ribbon-item='annotations']")).toHaveAttribute("data-ribbon-size", "large");
    expect(markups.querySelector("[data-ribbon-item='highlight']")).toHaveAttribute("data-ribbon-size", "small");
    // Home and View carry no groups, so their body has none.
    expect(screen.queryByRole("group", { name: "Page operations" })).not.toBeInTheDocument();
  });

  it("switches tabs upward with the shared ribbon's tab ids", () => {
    const onTabChange = vi.fn();
    render(<PdfRibbonBar {...baseProps} onTabChange={onTabChange} activeTab="home" commands={pageCommands} />);
    fireEvent.click(screen.getByRole("tab", { name: "Pages" }));
    expect(onTabChange).toHaveBeenCalledWith("pages");
  });

  it("reports Find changes through the trailing toggle", () => {
    const onFindToggle = vi.fn();
    render(<PdfRibbonBar {...baseProps} onFindToggle={onFindToggle} activeTab="home" commands={undoRedo} />);
    const find = screen.getByTestId("pdf-chrome-find");
    expect(find).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(find);
    expect(onFindToggle).toHaveBeenCalledOnce();
  });

  it("disables a ribbon item whose command is disabled and keeps it reachable", () => {
    const onCommand = vi.fn();
    const onExecute = vi.fn();
    render(
      <PdfRibbonBar
        {...baseProps}
        onCommand={onCommand}
        activeTab="annotate"
        commands={[
          command(PDF_COMMANDS.annotations, "Annotations"),
          { id: PDF_COMMANDS.highlight, label: "Highlight", disabled: true, onExecute },
        ]}
      />,
    );
    const highlight = document.querySelector("[data-ribbon-item='highlight']") as HTMLElement;
    expect(highlight).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(highlight);
    expect(onExecute).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
    expect(document.querySelector("[data-ribbon-item='annotations']")).not.toHaveAttribute("aria-disabled");
  });

  it("runs an enabled command through onExecute then onCommand", () => {
    const onCommand = vi.fn();
    const onExecute = vi.fn();
    render(
      <PdfRibbonBar
        {...baseProps}
        onCommand={onCommand}
        activeTab="annotate"
        commands={[{ id: PDF_COMMANDS.note, label: "Note", onExecute }]}
      />,
    );
    const note = document.querySelector("[data-ribbon-item='note']") as HTMLElement;
    fireEvent.click(note);
    expect(onExecute).toHaveBeenCalledOnce();
    expect(onCommand).toHaveBeenCalledWith(PDF_COMMANDS.note);
    expect(onExecute.mock.invocationCallOrder[0]).toBeLessThan(onCommand.mock.invocationCallOrder[0]!);
  });

  it("disables a quick undo whose command is disabled and does not execute it", () => {
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
  });
});
