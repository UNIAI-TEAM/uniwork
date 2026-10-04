import { describe, expect, it } from "vitest";
import { createPptxCommandMap } from "./command-map";
import {
  PPTX_RIBBON_CONTEXTUAL_TABS,
  PPTX_RIBBON_TABS,
  PPTX_TAB_ROW_COMMANDS,
  pptxGroupPriority,
  pptxRibbonCommandIds,
  pptxRibbonTabs,
} from "./pptx-ribbon";

const commands = createPptxCommandMap({ host: null });
const tabs = pptxRibbonTabs(commands);

describe("pptxRibbonTabs", () => {
  it("maps the eight fixed tabs in the existing order with FULL i18next keys", () => {
    expect(PPTX_RIBBON_TABS.map((tab) => tab.id)).toEqual([
      "home",
      "insert",
      "design",
      "transitions",
      "animations",
      "slide-show",
      "review",
      "view",
    ]);
    expect(tabs.slice(0, 8).map((tab) => tab.id)).toEqual(PPTX_RIBBON_TABS.map((tab) => tab.id));
    expect(tabs[0]!.labelKey).toBe("office.pptx.tabs.home");
    expect(tabs[5]!.labelKey).toBe("office.pptx.tabs.slide_show");
    // The shared ribbon translates at the root, so a relative key would echo.
    for (const tab of tabs) expect(tab.labelKey.startsWith("office.pptx.")).toBe(true);
    expect(tabs[0]!.groups[0]!.labelKey).toBe("office.pptx.groups.file");
    expect(tabs[0]!.groups[0]!.items[0]!.labelKey).toBe("office.pptx.commands.open");
  });

  it("assigns the collapse priority by group position: first 10, second 5, later 0", () => {
    expect(pptxGroupPriority(0)).toBe(10);
    expect(pptxGroupPriority(1)).toBe(5);
    expect(pptxGroupPriority(2)).toBe(0);
    expect(pptxGroupPriority(7)).toBe(0);
    // Home is the only multi-group tab today; its first group collapses last.
    const home = tabs[0]!;
    expect(home.groups.map((group) => group.priority)).toEqual([10, 5]);
    for (const tab of tabs.slice(1, 8)) {
      if (tab.groups.length === 1) expect(tab.groups[0]!.priority).toBe(10);
    }
    // The empty Transitions tab carries no group at all.
    expect(tabs[3]!.groups).toEqual([]);
  });

  it("maps one item per command: large for the group's primary, small after, disabled with its reason", () => {
    const file = tabs[0]!.groups[0]!;
    expect(file.items.map((item) => item.id)).toEqual(["open", "save", "export-pdf"]);
    expect(file.items.map((item) => item.size)).toEqual(["large", "small", "small"]);
    for (const item of file.items) expect(item.kind).toBe("button");

    const open = file.items[0]!;
    expect(open.disabled).toBe(false);
    expect(open.tooltipKey).toBeUndefined();

    const exportPdf = file.items[2]!;
    expect(exportPdf.disabled).toBe(true);
    // The tooltip is the capability reason, taken from the command map as-is.
    expect(exportPdf.tooltipKey).toBe(commands.find((command) => command.id === "export-pdf")!.capability.reason);

    const editing = tabs[0]!.groups[1]!;
    expect(editing.items.map((item) => item.id)).toEqual(["edit-text", "edit-shape-image"]);
    expect(editing.items[0]!.size).toBe("large");
    // No tab group command is a toggle today (the presenter toggle is tab-row).
    const kinds = tabs.flatMap((tab) => tab.groups.flatMap((group) => group.items.map((item) => item.kind)));
    expect(new Set(kinds)).toEqual(new Set(["button"]));
  });

  it("places every tab command exactly once and keeps the tab-row commands out", () => {
    const ids = pptxRibbonCommandIds(tabs);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "open", "save", "export-pdf", "edit-text", "edit-shape-image",
      "charts", "tables", "masters-layouts", "embedded-fonts",
      "animations", "fullscreen", "speaker-notes", "render-fidelity",
    ]);
    expect(ids).not.toContain("undo");
    expect(ids).not.toContain("redo");
    expect(ids).not.toContain("presenter");
    expect(ids).not.toContain("find");
    expect(PPTX_TAB_ROW_COMMANDS).toEqual(["undo", "redo", "presenter", "find"]);
  });

  it("gates the three contextual tabs on the caller's selection flags (R4)", () => {
    expect(PPTX_RIBBON_CONTEXTUAL_TABS.map((tab) => tab.labelKey)).toEqual([
      "office.pptx.context.picture",
      "office.pptx.context.shape",
      "office.pptx.context.table",
    ]);
    // No flags: the contextual tabs exist but carry when=false, so they hide.
    for (const tab of tabs.slice(8)) {
      expect(tab.contextual?.when).toBe(false);
      expect(tab.contextual?.accent).toBe("info");
    }

    const selected = pptxRibbonTabs(commands, { contextual: { table: true } });
    expect(selected.slice(8).map((tab) => tab.contextual?.when)).toEqual([false, false, true]);
    expect(selected[10]!.id).toBe("context-table");
    expect(selected[10]!.groups[0]!.items.map((item) => item.id)).toEqual(["tables"]);
  });

  it("pins the disabled state and its reason, and refuses to dispatch a dead command", () => {
    const byId = new Map(
      tabs.flatMap((tab) => tab.groups.flatMap((group) => group.items)).map((item) => [item.id, item]),
    );
    // A wave-B/C command keeps the command map's own reason as its tooltip.
    const exportPdf = byId.get("export-pdf")!;
    expect(exportPdf.disabled).toBe(true);
    expect(exportPdf.tooltipKey).toBe(commands.find((command) => command.id === "export-pdf")!.capability.reason);
    // An available command carries no reason tooltip.
    expect(byId.get("open")!.disabled).toBe(false);
    expect(byId.get("open")!.tooltipKey).toBeUndefined();

    const seen: string[] = [];
    const wired = pptxRibbonTabs(commands, { onCommand: (id) => seen.push(id) });
    const dead = wired[0]!.groups[0]!.items[2]!;
    if (dead.kind === "button") dead.onExecute();
    expect(seen).toEqual([]);
    const live = wired[0]!.groups[0]!.items[0]!;
    if (live.kind === "button") live.onExecute();
    expect(seen).toEqual(["open"]);
  });
  it("wires onCommand into every mapped item without changing its id", () => {
    const seen: string[] = [];
    const wired = pptxRibbonTabs(commands, { onCommand: (id) => seen.push(id) });
    const item = wired[0]!.groups[0]!.items[0]!;
    expect(item.kind).toBe("button");
    if (item.kind === "button") item.onExecute();
    expect(seen).toEqual(["open"]);
  });
});