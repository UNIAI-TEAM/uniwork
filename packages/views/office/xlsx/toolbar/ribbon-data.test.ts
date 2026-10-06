import { describe, expect, it, vi } from "vitest";
import type { RibbonGroup } from "../../ribbon";
import { xlsxRibbonTabs } from "./ribbon-data";
import type { XlsxToolbarGroupProps } from "./types";

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    permissions: {},
    selection: { sheet: "Data", address: "C1" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  };
}

function homeGroups(overrides: Partial<XlsxToolbarGroupProps> = {}): readonly RibbonGroup[] {
  return xlsxRibbonTabs(groupProps(overrides)).find((tab) => tab.id === "home")!.groups;
}

function shape(group: RibbonGroup | undefined) {
  return (group?.items ?? []).map((item) => `${item.id}:${item.kind}:${item.size ?? "small"}${item.rowBreak ? ":break" : ""}`);
}

describe("Home tab ribbon layout (Excel order)", () => {
  it("orders the groups Clipboard, Font, Alignment, Number, Conditional format, Cells, Editing", () => {
    expect(homeGroups().map((group) => group.id)).toEqual(["clipboard", "font", "alignment", "number", "conditional-format", "cells", "editing"]);
  });

  it("drops the repeated caption from the Cells panel only", () => {
    const groups = homeGroups();
    expect(groups.find((group) => group.id === "cells")?.panelCaption).toBe(false);
    expect(groups.find((group) => group.id === "editing")?.panelCaption).toBeUndefined();
  });

  it("leaves no pre-ribbon folded group on Home", () => {
    const ids = homeGroups().map((group) => group.id);
    for (const gone of ["sheets", "borders", "structure-size", "structure-merge", "clear", "painter"]) {
      expect(ids).not.toContain(gone);
    }
  });

  it("gives Clipboard one large Paste split, then Cut, Copy and the format painter as icons", () => {
    const clipboard = homeGroups().find((group) => group.id === "clipboard");
    expect(shape(clipboard)).toEqual([
      "clipboard-paste:split:large",
      "clipboard-cut:button:icon",
      "clipboard-copy:button:icon:break",
      "clipboard-painter:custom:icon:break",
    ]);
    const paste = clipboard!.items[0]!;
    expect(paste.labelKey).toBe("office.xlsx.toolbar.groups.clipboardItems.paste");
    expect(paste.tooltipKey).toBe("office.xlsx.actions.paste");
    // Only Paste and the three Styles commands (design review X1) are large on Home.
    const large = homeGroups().flatMap((group) => group.items).filter((item) => item.size === "large");
    expect(large.map((item) => item.id)).toEqual(["clipboard-paste", "conditional-format", "format-as-table", "cell-styles"]);
  });

  it("gives Number a format box on row 1 and Currency, Percent, Comma and the decimal steppers on row 2", () => {
    expect(shape(homeGroups().find((group) => group.id === "number"))).toEqual([
      "number-format-picker:custom:icon",
      "number-currency:button:icon:break",
      "number-percent:button:icon",
      "number-comma:button:icon",
      "number-increase-decimals:button:icon",
      "number-decrease-decimals:button:icon",
    ]);
  });

  it("stacks Insert, Delete and Format in Cells and Clear in Editing", () => {
    const groups = homeGroups();
    expect(shape(groups.find((group) => group.id === "cells"))).toEqual([
      "cells-insert:custom:icon",
      "cells-delete:custom:icon:break",
      "cells-format:custom:icon:break",
    ]);
    expect(shape(groups.find((group) => group.id === "editing"))).toEqual(["editing-clear:dropdown:small"]);
    const clear = groups.find((group) => group.id === "editing")!.items[0]!;
    expect(clear.kind === "dropdown" && clear.menu.map((entry) => entry.id)).toEqual([
      "editing-clear-content",
      "editing-clear-format",
      "editing-clear-all",
    ]);
  });

  it("lets every Home item shrink to an icon before its group folds", () => {
    for (const group of homeGroups().filter((entry) => ["clipboard", "number", "cells", "editing"].includes(entry.id))) {
      for (const item of group.items) expect(item.collapseAs ?? "icon").not.toBe("small");
    }
  });
});
