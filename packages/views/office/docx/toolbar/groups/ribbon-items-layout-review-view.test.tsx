// UNI-924 W-H: the Layout / Review / View groups now publish typed ribbon items.
// These tests read each typed item and prove its action still runs the same
// command the pre-typed toolbar entry ran (no command lost in the migration).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RibbonItem } from "../../../ribbon";
import type { DocxCommandRuntime } from "../../commands";
import type { DocxToolbarGroupContext } from "../types";
import { docxExportRibbonItems } from "../../export/docx-export-menu";
import { layoutPageDecorRibbonItems } from "./layout-page-decor";
import { layoutPageSetupRibbonItems } from "./layout-page-setup";
import { RibbonDialogHosts } from "./ribbon-open-store";
import { reviewCommentsRibbonItems } from "./review-comments";
import { reviewCompareRibbonItems } from "./review-compare";
import { reviewTrackChangesRibbonItems } from "./review-track-changes";
import { viewNavigationRibbonItems } from "./view-navigation";

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  return {
    editor: {} as DocxToolbarGroupContext["editor"],
    coordinator: {} as DocxToolbarGroupContext["coordinator"],
    format: null,
    commands: undefined,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  };
}

function itemById(items: readonly RibbonItem[], id: string): RibbonItem {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`missing ribbon item ${id}`);
  return item;
}

describe("Layout tab typed ribbon items", () => {
  it("opens the page-setup dialog from the split primary and its menu", () => {
    const commands = { setDocxSectionProperties: vi.fn(() => true) } as unknown as DocxCommandRuntime;
    const items = layoutPageSetupRibbonItems(context({ commands, format: { docxPageSetup: { sections: [], activeIndex: 0 } } as never }));
    const split = itemById(items, "layout-page-setup");
    expect(split).toMatchObject({ kind: "split", size: "large" });
    if (split.kind !== "split") throw new Error("expected split");
    expect(() => split.onExecute()).not.toThrow();
    expect(() => split.menu[0]!.onSelect()).not.toThrow();
    // The group component stays mounted through a zero-width host item so the
    // dialog it owns still renders.
    expect(itemById(items, "layout-page-setup-host")).toMatchObject({ kind: "custom", width: 0 });
  });

  it("opens the page-decoration dialog from the dropdown menu", () => {
    const commands = { applyDocxPageDecor: vi.fn(() => true) } as unknown as DocxCommandRuntime;
    const items = layoutPageDecorRibbonItems(context({ commands, format: { docxPageDecor: {} } as never }));
    const dropdown = itemById(items, "layout-page-decor");
    expect(dropdown).toMatchObject({ kind: "dropdown", size: "large" });
    if (dropdown.kind !== "dropdown") throw new Error("expected dropdown");
    expect(() => dropdown.menu[0]!.onSelect()).not.toThrow();
  });
});

describe("Review tab typed ribbon items", () => {
  it("keeps accept-all / reject-all on the track-changes split menu", () => {
    const commands = {
      acceptAllReviewChanges: vi.fn(() => true),
      rejectAllReviewChanges: vi.fn(() => true),
    } as unknown as DocxCommandRuntime;
    const items = reviewTrackChangesRibbonItems(context({ commands, format: { reviewChanges: [{ id: "a" }] } as never }));
    const split = itemById(items, "review-track-changes");
    if (split.kind !== "split") throw new Error("expected split");
    expect(split.size).toBe("large");
    split.menu[0]!.onSelect();
    split.menu[1]!.onSelect();
    expect(commands.acceptAllReviewChanges).toHaveBeenCalledTimes(1);
    expect(commands.rejectAllReviewChanges).toHaveBeenCalledTimes(1);
  });

  it("keeps the compose-comment command on the comments split menu", () => {
    const commands = { canAddDocxComment: vi.fn(() => true) } as unknown as DocxCommandRuntime;
    const items = reviewCommentsRibbonItems(context({ commands, format: { docxComments: [] } as never }));
    const split = itemById(items, "review-comments");
    if (split.kind !== "split") throw new Error("expected split");
    expect(split.menu[0]).toMatchObject({ id: "review-comments-new", disabled: false });
    expect(() => split.menu[0]!.onSelect()).not.toThrow();
  });

  it("opens the compare dialog from the typed button", () => {
    const commands = { compareDocumentTexts: vi.fn(() => []) } as unknown as DocxCommandRuntime;
    const items = reviewCompareRibbonItems(context({ commands, format: { docxCompareReady: true } as never }));
    const button = itemById(items, "review-compare");
    expect(button).toMatchObject({ kind: "button", size: "large", disabled: false });
    if (button.kind !== "button") throw new Error("expected button");
    expect(() => button.onExecute()).not.toThrow();
  });
});

describe("View tab typed ribbon items", () => {
  it("renders the navigation toggle as a live custom control (F6)", () => {
    const item = itemById(viewNavigationRibbonItems(context()), "view-navigation");
    expect(item.kind).toBe("custom");
    render(<div>{item.kind === "custom" ? item.render({ size: "large", inPanel: false }) : null}</div>);
    const toggle = screen.getByTestId("docx-navigation-ribbon-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByTestId("docx-navigation-ribbon-toggle")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("docx-navigation-ribbon-toggle"));
  });

  it("runs print / HTML / PDF from the export dropdown", async () => {
    const commands = {
      getState: vi.fn(() => ({ docxPageSetup: null, docxHeaderFooter: null })),
      buildDocxPrintCopy: vi.fn(() => "<html></html>"),
      downloadDocxHtml: vi.fn(() => true),
    } as unknown as DocxCommandRuntime;
    // UNI-952: Print prints the document copy through the injected port.
    const print = vi.fn(async () => ({ outcome: "printed" as const }));
    const items = docxExportRibbonItems(
      context({ commands, format: { docxExportReady: true } as never, print: { port: { print }, title: "Tài liệu" } }),
    );
    const dropdown = itemById(items, "export");
    if (dropdown.kind !== "dropdown") throw new Error("expected dropdown");
    expect(dropdown.size).toBe("large");
    dropdown.menu[0]!.onSelect();
    dropdown.menu[1]!.onSelect();
    await waitFor(() => expect(print).toHaveBeenCalledWith({ html: "<html></html>", title: "Tài liệu" }));
    expect(commands.downloadDocxHtml).toHaveBeenCalledTimes(1);
    // F2: the command takes LITERAL strings, so the typed path must pass the
    // translated file name/title, not the raw i18n keys.
    expect(commands.downloadDocxHtml).toHaveBeenCalledWith("tài liệu", "Tài liệu");
  });
});

describe("F7: typed-group dialogs mount in the fold-proof host", () => {
  it("keeps a dialog alive when the group's item tree folds away", () => {
    // RibbonDialogHosts mounts EVERY registered group's dialog owner, so the
    // context needs a command runtime that answers every area's render probes.
    const commands = new Proxy(
      { setDocxSectionProperties: vi.fn(() => true) },
      { get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : vi.fn()) },
    ) as unknown as DocxCommandRuntime;
    const section = {
      index: 0,
      firstBlockIndex: 0,
      lastBlockIndex: 0,
      pageWidth: 11906,
      pageHeight: 16838,
      orientation: "portrait",
      marginTop: 1440,
      marginRight: 1440,
      marginBottom: 1440,
      marginLeft: 1440,
      columns: 1,
      columnSpace: 720,
      startType: "nextPage",
    };
    const ctx = context({ commands, format: { docxPageSetup: { sections: [section], activeIndex: 0 } } as never });
    const items = layoutPageSetupRibbonItems(ctx);

    // The foldable item tree renders only the zero-width marker, never the
    // dialog: at stage 3 / in the simplified layout the ribbon mounts these
    // items inside a TRANSIENT popover, so a dialog rendered here would die.
    const tree = render(
      <div data-testid="foldable-items">
        {items.map((item) => (item.kind === "custom" ? item.render({ size: "large", inPanel: false }) : null))}
      </div>,
    );
    expect(screen.queryByTestId("docx-page-setup-dialog")).not.toBeInTheDocument();

    // The toolbar-level host is the stable mount point and owns the dialog.
    render(<RibbonDialogHosts {...ctx} />);
    const split = itemById(items, "layout-page-setup");
    if (split.kind !== "split") throw new Error("expected split");
    act(() => split.onExecute());
    expect(screen.getByTestId("docx-page-setup-dialog")).toBeInTheDocument();

    // Fold: the group's popover closes and its item tree unmounts - the dialog
    // must survive, because it lives outside that tree.
    tree.unmount();
    expect(screen.getByTestId("docx-page-setup-dialog")).toBeInTheDocument();
  });
});
