import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import { createPptxCommandMap } from "./command-map";
import { PptxToolbar } from "./toolbar";

initI18n();
beforeEach(async () => {
  await setLocale("en");
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
});

const commands = createPptxCommandMap({ host: null });

describe("PptxToolbar over the shared OfficeRibbon", () => {
  it("renders the shared ribbon tabs and the Home groups", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    expect(screen.getByRole("tablist", { name: "Ribbon tabs" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Home", "Insert", "Design", "Transitions", "Animations", "Slide Show", "Review", "View",
    ]);
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
    // The ribbon body carries one role=group per caption.
    expect(screen.getByRole("group", { name: "File" })).toHaveAttribute("data-ribbon-group", "file");
    expect(screen.getByRole("group", { name: "Editing" })).toHaveAttribute("data-ribbon-group", "editing");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("carries undo/redo in the quick-access slot and Find + presenter in the trailing slot", () => {
    const onCommand = vi.fn();
    render(<PptxToolbar commands={commands} onCommand={onCommand} canUndo canRedo />);
    const quick = document.querySelector("[data-pptx-quick-access]") as HTMLElement;
    const trailing = document.querySelector("[data-pptx-tab-row-trailing]") as HTMLElement;
    expect(quick.querySelector('[data-command="undo"]')).not.toBeNull();
    expect(quick.querySelector('[data-command="redo"]')).not.toBeNull();
    expect(trailing.querySelector('[data-command="presenter"]')).not.toBeNull();
    expect(trailing.querySelector('[data-command="find"]')).not.toBeNull();
    // They live inside the shared ribbon's own slots.
    expect(document.querySelector("[data-ribbon-quick-access]")).toContainElement(quick);
    expect(document.querySelector("[data-ribbon-trailing]")).toContainElement(trailing);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onCommand).toHaveBeenCalledWith("undo");
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(onCommand).toHaveBeenCalledWith("find");
  });

  it("switches the active tab's groups and keeps every command path intact", () => {
    const onCommand = vi.fn();
    render(<PptxToolbar commands={commands} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("tab", { name: "Slide Show" }));
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(onCommand).toHaveBeenCalledWith("fullscreen");
  });

  it("shows the presenter toggle pressed while the presenter is open", () => {
    const view = render(<PptxToolbar commands={commands} onCommand={vi.fn()} presenterOpen={false} />);
    expect(screen.getByRole("button", { name: "Presenter" })).toHaveAttribute("aria-pressed", "false");
    view.rerender(<PptxToolbar commands={commands} onCommand={vi.fn()} presenterOpen />);
    expect(screen.getByRole("button", { name: "Presenter" })).toHaveAttribute("aria-pressed", "true");
  });

  it("adds a contextual tab only when the caller says the object is selected (R4)", () => {
    const view = render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "Table Design" })).not.toBeInTheDocument();
    view.rerender(<PptxToolbar commands={commands} onCommand={vi.fn()} contextual={{ table: true }} />);
    const tableTab = screen.getByRole("tab", { name: "Table Design" });
    expect(tableTab).toHaveAttribute("data-ribbon-contextual", "info");
    // Selecting the object does not force-switch the active tab.
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
  });
});