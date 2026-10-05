import { Image, Shapes } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import vi_ from "@uniwork/core/i18n/locales/vi.json";
import { createPptxCommandMap } from "./command-map";
import { pptxShowGroupItems } from "./ribbon-show-items";
import {
  PPTX_RIBBON_CONTEXTUAL_TABS,
  PPTX_RIBBON_TABS,
  PPTX_TAB_ROW_COMMANDS,
  pptxGroupPriority,
  pptxRibbonCommandIds,
  pptxRibbonTabs,
} from "./pptx-ribbon";
import type { RibbonItem, RibbonTab } from "../ribbon";

const commands = createPptxCommandMap({ host: null });
const tabs = pptxRibbonTabs(commands);
const ALL_CONTEXT = { picture: true, shape: true, table: true, chart: true };

function resolve(resource: unknown, key: string): string | undefined {
  let node: unknown = resource;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

const itemsOf = (tab: RibbonTab): RibbonItem[] => tab.groups.flatMap((group) => group.items);
const allItems = (list: readonly RibbonTab[]): RibbonItem[] => list.flatMap(itemsOf);
const find = (list: readonly RibbonTab[], tabId: string, itemId: string): RibbonItem => {
  const item = itemsOf(list.find((tab) => tab.id === tabId)!).find((entry) => entry.id === itemId);
  if (!item) throw new Error(`no item ${itemId} in ${tabId}`);
  return item;
};
const exec = (item: RibbonItem) => {
  if (item.kind === "button" || item.kind === "toggle") item.onExecute();
};
const button = (id: string, size: "small" | "large" = "small"): RibbonItem => ({
  kind: "button",
  id,
  labelKey: "office.pptx.commands.find",
  size,
  onExecute: () => undefined,
});

describe("pptxRibbonTabs", () => {
  it("maps the eight fixed tabs in the existing order with FULL i18next keys", () => {
    expect(PPTX_RIBBON_TABS.map((tab) => tab.id)).toEqual([
      "home", "insert", "design", "transitions", "animations", "slide-show", "review", "view",
    ]);
    expect(tabs.slice(0, 8).map((tab) => tab.id)).toEqual(PPTX_RIBBON_TABS.map((tab) => tab.id));
    expect(tabs[0]!.labelKey).toBe("office.pptx.tabs.home");
    expect(tabs[5]!.labelKey).toBe("office.pptx.tabs.slide_show");
    for (const tab of tabs) expect(tab.labelKey.startsWith("office.pptx.")).toBe(true);
    const file = tabs[0]!.groups.find((group) => group.id === "file")!;
    expect(file.labelKey).toBe("office.pptx.groups.file");
    expect(file.items[0]!.labelKey).toBe("office.pptx.commands.open");
  });

  it("never renders an empty body: every fixed tab has a group and every group has items", () => {
    for (const tab of tabs.slice(0, 8)) {
      expect(tab.groups.length, tab.id).toBeGreaterThan(0);
      expect(itemsOf(tab).length, tab.id).toBeGreaterThan(0);
    }
    for (const tab of tabs) for (const group of tab.groups) expect(group.items.length, group.id).toBeGreaterThan(0);
  });

  it("assigns the collapse priority by position among the rendered groups", () => {
    expect(pptxGroupPriority(0)).toBe(10);
    expect(pptxGroupPriority(1)).toBe(5);
    expect(pptxGroupPriority(2)).toBe(0);
    const home = tabs[0]!;
    expect(home.groups.map((group) => group.id)).toEqual(["slides", "drawing", "editing", "file"]);
    expect(home.groups.map((group) => group.priority)).toEqual([10, 5, 0, 0]);
    // Injected groups join the ranking once the editor fills them.
    const filled = pptxRibbonTabs(commands, { groupItems: { font: [button("font-bold")] } });
    expect(filled[0]!.groups.map((group) => group.id)).toEqual(["slides", "font", "drawing", "editing", "file"]);
    expect(filled[0]!.groups.map((group) => group.priority)).toEqual([10, 5, 0, 0, 0]);
  });

  it("maps commands as large-first buttons; a state-dependent refusal keeps its i18n reason", () => {
    const file = tabs[0]!.groups.find((group) => group.id === "file")!;
    // Print and Export PDF have no surface on the default map, so they are not shown dead (R2-6).
    expect(file.items.map((item) => item.id)).toEqual(["open", "save"]);
    expect(file.items.map((item) => item.size)).toEqual(["large", "small"]);
    const open = file.items[0]!;
    expect(open.disabled).toBe(false);
    expect(open.tooltipKey).toBeUndefined();
    const notes = find(tabs, "review", "speaker-notes");
    expect(notes.disabled).toBe(true);
    expect(notes.tooltipKey).toBe("office.pptx.reasons.edit_unbound");
  });

  it("drops a command the host can never run instead of showing it dead (R2-6)", () => {
    const hidden = commands.filter((command) => command.capability.hidden).map((command) => command.id);
    expect(hidden).toEqual(expect.arrayContaining(["export-pdf", "print", "masters-layouts", "embedded-fonts", "render-fidelity", "edit-shape-image"]));
    const placed = allItems(tabs).map((item) => item.id);
    for (const id of hidden) expect(placed, id).not.toContain(id);
    // Binding the print surface brings both commands back, enabled, in the File group.
    const wired = pptxRibbonTabs(createPptxCommandMap({ host: null, capabilities: { "export-pdf": "available", print: "available" } }));
    const file = wired[0]!.groups.find((group) => group.id === "file")!;
    expect(file.items.map((item) => [item.id, item.disabled])).toEqual([["open", false], ["save", false], ["export-pdf", false], ["print", false]]);
  });

  it("places every tab command exactly once and keeps the tab-row commands out", () => {
    const ids = pptxRibbonCommandIds(tabs);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(
      commands
        .filter((command) => command.capability.hidden !== true)
        .map((command) => command.id)
        .filter((id) => !PPTX_TAB_ROW_COMMANDS.includes(id))
        .sort(),
    );
    for (const id of PPTX_TAB_ROW_COMMANDS) expect(ids).not.toContain(id);
    expect(PPTX_TAB_ROW_COMMANDS).toEqual(["undo", "redo", "presenter", "find"]);
  });

  it("keeps only injected non-command items out of pptxRibbonCommandIds", () => {
    const wired = pptxRibbonTabs(commands, {
      groupItems: { font: [button("font-bold")], arrange: [button("arrange-front")], show: [button("show-from-start", "large")] },
    });
    expect(pptxRibbonCommandIds(wired)).toEqual(pptxRibbonCommandIds(tabs));
  });

  it("makes From Beginning the only large item of the Slide Show group, first", () => {
    const show = pptxShowGroupItems({ canShow: true, onFromStart: vi.fn(), onFromCurrent: vi.fn(), onPresenterView: vi.fn() });
    const wired = pptxRibbonTabs(commands, { groupItems: { show } });
    const group = wired.find((tab) => tab.id === "slide-show")!.groups.find((entry) => entry.id === "show")!;
    expect(group.items.map((item) => item.id)).toEqual(["show-from-start", "show-from-current", "show-presenter-view", "fullscreen"]);
    expect(group.items.filter((item) => item.size === "large").map((item) => item.id)).toEqual(["show-from-start"]);
    expect(group.items[0]!.size).toBe("large");
  });

  it("regroups Insert into Office-like groups with one large item each", () => {
    const insert = tabs.find((tab) => tab.id === "insert")!;
    expect(insert.groups.map((group) => group.id)).toEqual(["slides", "tables", "images", "text", "media"]);
    expect(insert.groups.find((group) => group.id === "images")!.items.map((item) => [item.id, item.size])).toEqual([
      ["panel-insert", "large"],
      ["charts", "small"],
    ]);
    expect(insert.groups.find((group) => group.id === "text")!.items.map((item) => [item.id, item.size])).toEqual([
      ["panel-headerfooter", "large"],
      ["panel-links", "small"],
    ]);
    for (const group of insert.groups) expect(group.items.filter((item) => item.size === "large").length, group.id).toBe(1);
  });

  it("draws the Insert Shapes large item with the shapes icon, not the generic image one (R2-13)", () => {
    const insert = tabs.find((tab) => tab.id === "insert")!;
    const shapes = insert.groups.find((group) => group.id === "images")!.items.find((item) => item.id === "panel-insert")!;
    expect(shapes.icon).toBe(Shapes);
    expect(shapes.icon).not.toBe(Image);
  });

  it("gates the four contextual tabs on the selection flags (R4), chart included", () => {
    expect(PPTX_RIBBON_CONTEXTUAL_TABS.map((tab) => tab.labelKey)).toEqual([
      "office.pptx.context.picture",
      "office.pptx.context.shape",
      "office.pptx.context.table",
      "office.pptx.context.chart",
    ]);
    for (const tab of tabs.slice(8)) {
      expect(tab.contextual?.when).toBe(false);
      expect(tab.contextual?.accent).toBe("info");
    }
    const chart = pptxRibbonTabs(commands, { contextual: { chart: true } });
    expect(chart.slice(8).map((tab) => tab.contextual?.when)).toEqual([false, false, false, true]);
    expect(chart[11]!.id).toBe("context-chart");
    expect(itemsOf(chart[11]!).map((item) => item.id)).toEqual(["charts"]);
    const table = pptxRibbonTabs(commands, { contextual: { table: true } });
    expect(table[10]!.id).toBe("context-table");
    expect(itemsOf(table[10]!).map((item) => item.id)).toEqual(["tables"]);
  });

  it("gives every contextual tab more than one item once panels and arrange items are in", () => {
    const arrange = [button("arrange-front")];
    const wired = pptxRibbonTabs(commands, { groupItems: { arrange } });
    for (const tab of wired.slice(8)) {
      expect(itemsOf(tab).length, tab.id).toBeGreaterThan(1);
      expect(tab.groups.find((group) => group.id === "arrange")?.items).toEqual(arrange);
    }
    // Without the injection the group is dropped rather than rendered empty.
    for (const tab of tabs.slice(8)) expect(tab.groups.some((group) => group.id === "arrange")).toBe(false);
    expect(itemsOf(wired[8]!).map((item) => item.id)).toEqual(["panel-format", "panel-insert", "panel-links", "arrange-front"]);
  });

  it("renders panel items as toggles, pressed for the active panel, dispatching onOpenPanel", () => {
    const onOpenPanel = vi.fn();
    const wired = pptxRibbonTabs(commands, { activePanel: "transitions", onOpenPanel });
    const transitions = find(wired, "transitions", "panel-transitions");
    expect(transitions.kind).toBe("toggle");
    expect(transitions.kind === "toggle" && transitions.pressed).toBe(true);
    expect(transitions.labelKey).toBe("office.pptx.panels.transitions");
    const themes = find(wired, "design", "panel-design");
    expect(themes.kind === "toggle" && themes.pressed).toBe(false);
    exec(themes);
    expect(onOpenPanel).toHaveBeenCalledWith("design");
    expect(find(wired, "insert", "panel-insert").tooltipKey).toBe("office.pptx.panels.shapes_hint");
  });

  it("refuses to open a disabled panel and carries the reason as its tooltip", () => {
    const onOpenPanel = vi.fn();
    const reason = "office.pptx.reasons.edit_unbound";
    const wired = pptxRibbonTabs(commands, { onOpenPanel, panelDisabled: { media: reason } });
    const media = find(wired, "insert", "panel-media");
    expect(media.disabled).toBe(true);
    expect(media.tooltipKey).toBe(reason);
    exec(media);
    expect(onOpenPanel).not.toHaveBeenCalled();
  });

  it("keeps item ids unique inside every tab, and puts the view panel before the command", () => {
    const wired = pptxRibbonTabs(commands, { contextual: ALL_CONTEXT });
    for (const tab of wired) {
      const ids = itemsOf(tab).map((item) => item.id);
      expect(new Set(ids).size, tab.id).toBe(ids.length);
    }
    expect(itemsOf(wired.find((tab) => tab.id === "view")!).map((item) => item.id)).toEqual(["panel-sorter"]);
  });

  it("opens the matching panel from a group launcher, and never when it is disabled", () => {
    const onOpenPanel = vi.fn();
    const wired = pptxRibbonTabs(commands, { onOpenPanel });
    wired[0]!.groups.find((group) => group.id === "drawing")!.launcher!.onOpen();
    expect(onOpenPanel).toHaveBeenCalledWith("format");
    const blocked = pptxRibbonTabs(commands, { onOpenPanel, panelDisabled: { format: "office.pptx.reasons.edit_unbound" } });
    onOpenPanel.mockClear();
    blocked[0]!.groups.find((group) => group.id === "drawing")!.launcher!.onOpen();
    expect(onOpenPanel).not.toHaveBeenCalled();
  });

  it("appends injected groupItems to their group; Font and Paragraph never add a large item", () => {
    const font = button("font-bold");
    const wired = pptxRibbonTabs(commands, { groupItems: { font: [font], paragraph: [button("para-left")], show: [button("start-show", "large")] } });
    const home = wired[0]!;
    expect(home.groups.find((group) => group.id === "font")!.items).toEqual([font]);
    expect(home.groups.find((group) => group.id === "font")!.launcher).toBeDefined();
    expect(itemsOf(wired.find((tab) => tab.id === "slide-show")!).map((item) => item.id)).toEqual(["start-show", "fullscreen"]);
    const sizes = home.groups.filter((group) => group.id === "font" || group.id === "paragraph").flatMap((group) => group.items.map((item) => item.size));
    expect(sizes).not.toContain("large");
  });

  it("keeps the label of every LARGE item within 14 characters in en and vi (F-16)", () => {
    const wired = pptxRibbonTabs(commands, { contextual: ALL_CONTEXT });
    const large = allItems(wired).filter((item) => item.size === "large");
    expect(large.length).toBeGreaterThan(8);
    for (const item of large) {
      for (const [name, resource] of [["en", en], ["vi", vi_]] as const) {
        const label = resolve(resource, item.labelKey);
        expect(label, `${name}:${item.labelKey}`).toBeTypeOf("string");
        expect(label!.length, `${name}:${item.labelKey}="${label}"`).toBeLessThanOrEqual(14);
      }
    }
  });

  it("carries every disabled reason as a full office.pptx i18n key that exists in both locales", () => {
    const disabled = allItems(pptxRibbonTabs(commands, { contextual: ALL_CONTEXT })).filter((item) => item.disabled);
    expect(disabled.length).toBeGreaterThan(0);
    for (const item of disabled) {
      expect(item.tooltipKey?.startsWith("office.pptx."), item.id).toBe(true);
      expect(resolve(en, item.tooltipKey!), item.tooltipKey).toBeTypeOf("string");
      expect(resolve(vi_, item.tooltipKey!), item.tooltipKey).toBeTypeOf("string");
    }
  });

  it("refuses to dispatch a dead command and dispatches a live one", () => {
    const seen: string[] = [];
    const wired = pptxRibbonTabs(commands, { onCommand: (id) => seen.push(id) });
    exec(find(wired, "review", "speaker-notes"));
    expect(seen).toEqual([]);
    exec(find(wired, "home", "open"));
    expect(seen).toEqual(["open"]);
  });
});
