import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("restores the F4 disabled-reason tooltip: undo says why it is dead, without a native title", () => {
    // F4 regression: the disabled reason is a real role=tooltip node, never a
    // native title (which a disabled control suppresses for keyboard users).
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} canUndo={false} canRedo={false} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();
    expect(undo).not.toHaveAttribute("title");
    // The undo control's OWN tooltip carries the reason. Scope the query to the
    // button's wrapper: the redo tooltip and the Find hint are also
    // role="tooltip", so an unscoped getByRole would be non-unique.
    const undoWrap = undo.closest("span") as HTMLElement;
    expect(within(undoWrap).getByRole("tooltip")).toHaveTextContent("No edit history yet.");
  });

  it("restores the F6 presenter pressed wash: a pressed toggle paints the selected token", () => {
    const view = render(<PptxToolbar commands={commands} onCommand={vi.fn()} presenterOpen={false} />);
    const presenter = () => screen.getByRole("button", { name: "Presenter" });
    expect(presenter().className).not.toContain("bg-surface-selected");
    view.rerender(<PptxToolbar commands={commands} onCommand={vi.fn()} presenterOpen />);
    expect(presenter()).toHaveAttribute("aria-pressed", "true");
    expect(presenter().className).toContain("bg-surface-selected");
  });

  it("restores the undo/redo history remap: a bound journal enables the controls", () => {
    // With real history the remap must not touch the command: undo/redo stay
    // enabled and carry no history_empty reason tooltip.
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} canUndo canRedo />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).not.toBeDisabled();
    expect(screen.queryByText("No edit history yet.")).not.toBeInTheDocument();
  });

  it("restores the empty-tab note: the Transitions tab explains itself instead of a blank band", () => {
    render(<PptxToolbar commands={commands} onCommand={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Transitions" }));
    expect(screen.getByText("This tab has no commands yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
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
