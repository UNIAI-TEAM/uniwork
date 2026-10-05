import { describe, expect, it, vi } from "vitest";
import type { TextEdit } from "@uniwork/office-engine/pptx";
import type { RibbonComboItem, RibbonDropdownItem, RibbonItem, RibbonToggleItem } from "../ribbon/types";
import { run, shapeNode, slide, textLayout } from "./canvas/pptx-render-fixtures";
import {
  pptxArrangeGroupItems,
  pptxFontGroupItems,
  pptxParagraphGroupItems,
  pptxTextFormatState,
  type PptxFormatTarget,
  type PptxTextGroupOptions,
} from "./ribbon-format-items";

const target: PptxFormatTarget = { slideIndex: 2, elementId: "el-1", elementType: "text", ids: ["el-1"] };

function opts(over: Partial<PptxTextGroupOptions> = {}): { o: PptxTextGroupOptions; apply: ReturnType<typeof vi.fn> } {
  const apply = vi.fn<(e: TextEdit) => void>();
  return { o: { target, state: {}, apply, ...over }, apply };
}

function get<T extends RibbonItem>(items: RibbonItem[], id: string): T {
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error("missing " + id);
  return item as T;
}

function press(item: RibbonItem): void {
  if (item.kind === "toggle" || item.kind === "button") item.onExecute();
}

describe("font group", () => {
  it("has the stable ids and the row break on bold", () => {
    const items = pptxFontGroupItems(opts().o);
    expect(items.map((i) => i.id)).toEqual([
      "font-family",
      "font-size",
      "font-bold",
      "font-italic",
      "font-underline",
      "font-strike",
      "font-color",
    ]);
    expect(get(items, "font-bold").rowBreak).toBe(true);
  });

  it.each([
    ["no selection", { target: { ...target, elementId: null, ids: [] } }, "office.pptx.text.format.empty"],
    ["unbound", { apply: undefined }, "office.pptx.text.format.unbound"],
    ["unsupported", { target: { ...target, elementType: "picture" } }, "office.pptx.text.format.unsupported"],
  ])("disables everything: %s", (_n, over, reason) => {
    const { o, apply } = opts(over as Partial<PptxTextGroupOptions>);
    const items = [...pptxFontGroupItems(o), ...pptxParagraphGroupItems(o)];
    for (const item of items) {
      expect(item.disabled).toBe(true);
      expect(item.tooltipKey).toBe(reason);
      press(item);
      if (item.kind === "combo") item.onChange("12");
      if (item.kind === "dropdown") item.menu.forEach((m) => m.onSelect());
    }
    expect(apply).not.toHaveBeenCalled();
  });

  it("toggles emit set_font with the negated pressed state", () => {
    const off = opts();
    press(get(pptxFontGroupItems(off.o), "font-bold"));
    expect(off.apply).toHaveBeenCalledWith({ op: "set_font", slideIndex: 2, elementId: "el-1", font: { bold: true } });
    const on = opts({ state: { bold: true } });
    const bold = get<RibbonToggleItem>(pptxFontGroupItems(on.o), "font-bold");
    expect(bold.pressed).toBe(true);
    expect(bold.shortcut).toBe("Ctrl+B");
    press(bold);
    expect(on.apply).toHaveBeenCalledWith({ op: "set_font", slideIndex: 2, elementId: "el-1", font: { bold: false } });
    const s = opts();
    press(get(pptxFontGroupItems(s.o), "font-strike"));
    expect(s.apply).toHaveBeenCalledWith(expect.objectContaining({ font: { strike: true } }));
  });

  it("family and size combos emit exact edits and show current values", () => {
    const { o, apply } = opts({ state: { fontFamily: "Arial", fontSizePt: 18 } });
    const items = pptxFontGroupItems(o);
    const fam = get<RibbonComboItem>(items, "font-family");
    const size = get<RibbonComboItem>(items, "font-size");
    expect(fam.value).toBe("Arial");
    expect(fam.width).toBe(140);
    expect(size.value).toBe("18");
    expect(size.width).toBe(56);
    fam.onChange("Georgia");
    size.onChange("24");
    expect(apply).toHaveBeenNthCalledWith(1, expect.objectContaining({ font: { fontFamily: "Georgia" } }));
    expect(apply).toHaveBeenNthCalledWith(2, expect.objectContaining({ font: { fontSizePt: 24 } }));
  });

  it("swallows a refused size", () => {
    const { o, apply } = opts();
    get<RibbonComboItem>(pptxFontGroupItems(o), "font-size").onChange("abc");
    expect(apply).not.toHaveBeenCalled();
  });

  it("colour menu emits a colour and more calls onMoreOptions", () => {
    const more = vi.fn();
    const { o, apply } = opts({ onMoreOptions: more });
    const menu = get<RibbonDropdownItem>(pptxFontGroupItems(o), "font-color").menu;
    expect(menu.map((m) => m.labelKey)).toContain("office.pptx.colors.blue");
    menu.find((m) => m.id === "font-color-red")?.onSelect();
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ font: { color: "#C00000" } }));
    menu.find((m) => m.labelKey === "office.pptx.colors.more")?.onSelect();
    expect(more).toHaveBeenCalledTimes(1);
    const without = get<RibbonDropdownItem>(pptxFontGroupItems(opts().o), "font-color").menu;
    expect(without.some((m) => m.labelKey === "office.pptx.colors.more")).toBe(false);
  });
});

describe("font group: multi-selection, disabled combos, more colors", () => {
  it("applies one edit per text id, anchor first, and skips an id whose builder refuses", () => {
    const { o, apply } = opts({ target: { ...target, elementId: "a", ids: ["a", "b"], textIds: ["a", "b"] } });
    press(get(pptxFontGroupItems(o), "font-bold"));
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, expect.objectContaining({ elementId: "a", font: { bold: true } }));
    expect(apply).toHaveBeenNthCalledWith(2, expect.objectContaining({ elementId: "b", font: { bold: true } }));
    const single = opts();
    press(get(pptxFontGroupItems(single.o), "font-bold"));
    expect(single.apply).toHaveBeenCalledTimes(1);
  });

  it("emits a custom item for a disabled combo and a plain combo when enabled", () => {
    const off = pptxFontGroupItems(opts({ apply: undefined }).o);
    for (const id of ["font-family", "font-size"]) expect(get(off, id).kind).toBe("custom");
    expect(get(off, "font-family").id).toBe("font-family");
    expect(get(pptxParagraphGroupItems(opts({ apply: undefined }).o), "para-line-spacing").kind).toBe("custom");
    expect(get(pptxFontGroupItems(opts().o), "font-family").kind).toBe("combo");
  });

  it("disables More colors with the reason, and keeps it live when enabled", () => {
    const off = get<RibbonDropdownItem>(pptxFontGroupItems(opts({ apply: undefined, onMoreOptions: vi.fn() }).o), "font-color").menu;
    expect(off.find((m) => m.id === "font-color-more")?.disabled).toBe(true);
    const on = get<RibbonDropdownItem>(pptxFontGroupItems(opts({ onMoreOptions: vi.fn() }).o), "font-color").menu;
    expect(on.find((m) => m.id === "font-color-more")?.disabled).toBeUndefined();
  });
});

describe("paragraph group", () => {
  it("align toggles reflect state and emit set_paragraph_format", () => {
    const { o, apply } = opts({ state: { align: "center" } });
    const items = pptxParagraphGroupItems(o);
    expect(items.map((i) => i.id)).toEqual([
      "align-left",
      "align-center",
      "align-right",
      "align-justify",
      "para-bullets",
      "para-line-spacing",
    ]);
    expect(get<RibbonToggleItem>(items, "align-center").pressed).toBe(true);
    expect(get<RibbonToggleItem>(items, "align-left").pressed).toBe(false);
    press(get(items, "align-justify"));
    expect(apply).toHaveBeenCalledWith({
      op: "set_paragraph_format",
      slideIndex: 2,
      elementId: "el-1",
      format: { align: "justify" },
    });
  });

  it("bullets and line spacing emit exact edits", () => {
    const { o, apply } = opts();
    const items = pptxParagraphGroupItems(o);
    const bullets = get<RibbonDropdownItem>(items, "para-bullets").menu;
    expect(bullets.map((m) => m.labelKey)).toEqual([
      "office.pptx.text.format.bullet.none",
      "office.pptx.text.format.bullet.char",
      "office.pptx.text.format.bullet.number",
    ]);
    bullets[2]?.onSelect();
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ format: { bullet: "number" } }));
    const spacing = get<RibbonComboItem>(items, "para-line-spacing");
    expect(spacing.width).toBe(64);
    expect(spacing.options.map((p) => p.label)).toContain("1.15");
    spacing.onChange("150");
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ format: { lineSpacingPct: 150 } }));
  });
});

describe("arrange group", () => {
  it("calls reorder and remove", () => {
    const reorder = vi.fn();
    const remove = vi.fn();
    const items = pptxArrangeGroupItems({ target, reorder, remove });
    expect(items.map((i) => i.id)).toEqual(["arrange-front", "arrange-back", "arrange-delete"]);
    items.forEach(press);
    expect(reorder.mock.calls).toEqual([["front"], ["back"]]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("is disabled without a selection or handlers", () => {
    const reorder = vi.fn();
    const remove = vi.fn();
    const none = pptxArrangeGroupItems({ target: { ...target, elementId: null, ids: [] }, reorder, remove });
    none.forEach((i) => {
      expect(i.disabled).toBe(true);
      expect(i.tooltipKey).toBe("office.pptx.context_menu.reason_no_selection");
      press(i);
    });
    const unbound = pptxArrangeGroupItems({ target });
    expect(unbound.map((i) => i.tooltipKey)).toEqual([
      "office.pptx.context_menu.reason_reorder_unbound",
      "office.pptx.context_menu.reason_reorder_unbound",
      "office.pptx.context_menu.reason_delete_unbound",
    ]);
    unbound.forEach(press);
    expect(reorder).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("pptxTextFormatState", () => {
  const tree = slide([
    shapeNode({
      sourceId: "el-1",
      type: "text",
      text: textLayout({
        lines: [
          {
            runs: [run({ fontSizePx: 24, bold: true, fontFamily: "Calibri", strike: true })],
            top: 0,
            height: 30,
            align: "right",
          },
        ],
      }),
    }),
  ]);

  it("reads the first run and converts px to pt (96 dpi baseline x scale)", () => {
    expect(pptxTextFormatState(tree, "el-1")).toEqual({
      bold: true,
      italic: false,
      underline: false,
      strike: true,
      fontFamily: "Calibri",
      fontSizePt: 18,
      align: "right",
    });
    const scaled = slide(tree.nodes, { scale: 0.5 });
    expect(pptxTextFormatState(scaled, "el-1").fontSizePt).toBe(36);
  });

  it("returns {} for unknown id, null tree or null id", () => {
    expect(pptxTextFormatState(tree, "nope")).toEqual({});
    expect(pptxTextFormatState(null, "el-1")).toEqual({});
    expect(pptxTextFormatState(tree, null)).toEqual({});
  });
});
