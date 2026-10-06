import { describe, expect, it, vi } from "vitest";
import { createPptxCommandMap } from "./command-map";
import { gatePptxRibbonForMasterView, PPTX_MASTER_VIEW_REASON } from "./pptx-ribbon-master-gate";
import { pptxRibbonTabs } from "./pptx-ribbon";
import { pptxArrangeGroupItems, pptxFontGroupItems, pptxParagraphGroupItems } from "./ribbon-format-items";
import type { RibbonItem, RibbonTab } from "../ribbon";

/**
 * UNI-939 master_fix3 #1: with the master view open, the canvas shows a part preview, so
 * every ribbon item that would write the hidden slide is locked. The lock is an allowlist:
 * enumerate the whole ribbon (every tab, the contextual tabs, the injected items) and
 * assert that ONLY the allowlisted items stay enabled.
 */
const available = createPptxCommandMap({ host: null }).map((command) => ({ ...command, capability: { status: "available" as const } }));
const ALL_CONTEXT = { picture: true, shape: true, table: true, chart: true };
const target = { slideIndex: 0, elementId: "e1", elementType: "shape", ids: ["e1"] };

/** Enabled items that may stay live: file, view and slide-show items, Close master. */
const ALLOWED = ["export-pdf", "fullscreen", "open", "panel-sorter", "print", "render-fidelity", "save", "slideMaster"];

function build() {
  const onCommand = vi.fn();
  const onOpenPanel = vi.fn();
  const apply = vi.fn();
  const text = { target, state: {}, apply, onMoreOptions: vi.fn() };
  const tabs = pptxRibbonTabs(available, {
    onCommand,
    onOpenPanel,
    contextual: ALL_CONTEXT,
    groupItems: {
      font: pptxFontGroupItems(text),
      paragraph: pptxParagraphGroupItems(text),
      arrange: pptxArrangeGroupItems({ target, reorder: vi.fn(), remove: vi.fn() }),
    },
  });
  return { tabs, onCommand, onOpenPanel, apply };
}

const itemsOf = (tab: RibbonTab): RibbonItem[] => tab.groups.flatMap((group) => group.items);
const enabled = (tabs: readonly RibbonTab[]): string[] => tabs.flatMap((tab) => itemsOf(tab).filter((item) => !item.disabled).map((item) => `${tab.id}/${item.id}`));
const item = (tabs: readonly RibbonTab[], tabId: string, id: string): RibbonItem => {
  const found = itemsOf(tabs.find((tab) => tab.id === tabId)!).find((entry) => entry.id === id);
  if (!found) throw new Error(`no item ${id} in ${tabId}`);
  return found;
};

describe("gatePptxRibbonForMasterView", () => {
  it("baseline: the Insert-tab items the visual stage flagged are live when the view is closed", () => {
    const { tabs } = build();
    for (const id of ["panel-sorter", "panel-insert", "panel-headerfooter", "panel-links", "panel-media", "tables", "charts"]) {
      expect(item(tabs, "insert", id).disabled, id).toBeFalsy();
    }
  });

  it("keeps only the allowlist enabled across every tab, contextual tab and injected group", () => {
    const { tabs } = build();
    const gated = gatePptxRibbonForMasterView(tabs);
    expect(gated.length).toBe(tabs.length);
    const live = enabled(gated);
    expect([...new Set(live.map((entry) => entry.split("/")[1]))].sort()).toEqual(ALLOWED);
    // The live items sit in the file (Home), views (View) and show (Slide show) groups, and nowhere else.
    expect(live.sort()).toEqual([
      "home/export-pdf", "home/open", "home/print", "home/save", "slide-show/fullscreen", "view/panel-sorter", "view/render-fidelity", "view/slideMaster",
    ]);
  });

  it("locks Trang moi / Hinh dang / Dau-chan trang / Lien ket / Phuong tien with the master reason", () => {
    const { tabs, onCommand, onOpenPanel } = build();
    const gated = gatePptxRibbonForMasterView(tabs);
    for (const id of ["panel-sorter", "panel-insert", "panel-headerfooter", "panel-links", "panel-media"]) {
      const locked = item(gated, "insert", id);
      expect(locked.disabled, id).toBe(true);
      expect(locked.tooltipKey, id).toBe(PPTX_MASTER_VIEW_REASON);
      if (locked.kind === "toggle") locked.onExecute();
    }
    for (const id of ["tables", "charts"]) expect(item(gated, "insert", id).disabled, id).toBe(true);
    expect(onOpenPanel).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("locks Home font/paragraph/arrange items with the master reason, not the generic selection one, and nothing executes", () => {
    const { tabs, onCommand, apply } = build();
    const gated = gatePptxRibbonForMasterView(tabs);
    const home = gated.find((tab) => tab.id === "home")!;
    for (const group of home.groups.filter((entry) => ["font", "paragraph", "drawing", "editing", "slides", "arrange"].includes(entry.id))) {
      for (const entry of group.items) {
        expect(entry.disabled, entry.id).toBe(true);
        expect(entry.tooltipKey, entry.id).toBe(PPTX_MASTER_VIEW_REASON);
        if (entry.kind === "button" || entry.kind === "toggle" || entry.kind === "split") entry.onExecute();
        if (entry.kind === "dropdown" || entry.kind === "split") for (const menuEntry of entry.menu) { expect(menuEntry.disabled).toBe(true); menuEntry.onSelect(); }
        if (entry.kind === "combo") entry.onChange("x");
      }
      group.launcher?.onOpen();
    }
    // The contextual tabs (arrange, picture, shape, table, chart) are locked too.
    for (const tab of gated.filter((entry) => entry.contextual)) for (const entry of itemsOf(tab)) expect(entry.disabled, `${tab.id}/${entry.id}`).toBe(true);
    expect(onCommand).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not mutate the input ribbon", () => {
    const { tabs } = build();
    const before = enabled(tabs);
    gatePptxRibbonForMasterView(tabs);
    expect(enabled(tabs)).toEqual(before);
  });
});
