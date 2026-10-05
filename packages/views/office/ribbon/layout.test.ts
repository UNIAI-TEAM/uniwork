import { Bold, Scissors } from "lucide-react";
import { describe, expect, it } from "vitest";
import { galleryVisible, groupBlocks, groupWidth, itemSize, planRibbonStages, ribbonStepCount, textMeasure } from "./layout";
import { ribbonFixture } from "./test/fixtures";
import type { RibbonGalleryItem, RibbonGroup, RibbonItem } from "./types";

const measure = textMeasure((key) => key);
const button = (id: string, extra: Partial<RibbonItem> = {}): RibbonItem =>
  ({ kind: "button", id, labelKey: id, icon: Scissors, onExecute: () => {}, ...extra }) as RibbonItem;

describe("itemSize", () => {
  it("shrinks large -> small -> icon by stage", () => {
    const item = button("paste", { size: "large" });
    expect([0, 1, 2].map((stage) => itemSize(item, stage as 0 | 1 | 2))).toEqual(["large", "small", "icon"]);
  });

  it("never goes below collapseAs, nor below small without an icon", () => {
    expect(itemSize(button("paste", { size: "large", collapseAs: "large" }), 2)).toBe("large");
    expect(itemSize(button("x", { icon: undefined }), 2)).toBe("small");
    expect(itemSize(button("x", { size: "icon", collapseAs: "large" }), 0)).toBe("icon");
  });
});

describe("galleryVisible", () => {
  const gallery = { kind: "gallery", id: "g", labelKey: "g", maxVisible: 5, minVisible: 1, options: Array.from({ length: 8 }, (_, i) => ({ id: `${i}` })), selectedId: null, onSelect: () => {} } as RibbonGalleryItem;
  it("shows fewer cards as the group shrinks", () => {
    expect([0, 1, 2].map((stage) => galleryVisible(gallery, stage as 0 | 1 | 2))).toEqual([5, 3, 1]);
    expect(galleryVisible({ ...gallery, options: gallery.options.slice(0, 2) }, 0)).toBe(2);
  });
});

describe("groupBlocks", () => {
  it("stacks small items three per column and gives large items their own column", () => {
    const items = [button("a", { size: "large" }), button("b"), button("c"), button("d"), button("e")];
    expect(groupBlocks(items, 0).map((block) => block.kind)).toEqual(["large", "column", "column"]);
    expect(groupBlocks(items, 2).map((block) => block.kind)).toEqual(["strip"]);
  });

  it("splits icon strips at rowBreak, or balances long runs into rows", () => {
    const font = ribbonFixture().tabs[0]?.groups[1] as RibbonGroup;
    const [strip] = groupBlocks(font.items, 0);
    expect(strip?.kind === "strip" && strip.rows.map((row) => row.map((item) => item.id))).toEqual([
      ["font-family"],
      ["bold", "italic", "underline"],
    ]);
    const many = Array.from({ length: 8 }, (_, i) => button(`i${i}`, { size: "icon", icon: Bold }));
    const [balanced] = groupBlocks(many, 0);
    expect(balanced?.kind === "strip" && balanced.rows.map((row) => row.length)).toEqual([4, 4]);
  });
});

describe("planRibbonStages", () => {
  const groups = ribbonFixture().tabs[0]?.groups as RibbonGroup[];
  const full = groups.reduce((sum, group) => sum + groupWidth(group, 0, measure), 0);

  it("keeps every group at full size when it fits", () => {
    expect(planRibbonStages(groups, full, measure)).toEqual([0, 0, 0, 0, 0]);
    expect(planRibbonStages(groups, Number.POSITIVE_INFINITY, measure)).toEqual([0, 0, 0, 0, 0]);
  });

  it("collapses the lowest priority group first", () => {
    const stages = planRibbonStages(groups, full - 1, measure);
    // editing (priority 0) shrinks first (its small button becomes an icon);
    // nothing else moves.
    expect(stages.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(stages[4]).toBeGreaterThan(0);
  });

  it("walks every group down to one button when nothing fits", () => {
    expect(planRibbonStages(groups, 0, measure)).toEqual([3, 3, 3, 3, 3]);
  });

  it("collapses equal priorities from the right", () => {
    const twins: RibbonGroup[] = ["left", "right"].map((id) => ({ id, labelKey: id, priority: 1, items: [button(`${id}-a`)] }));
    const width = groupWidth(twins[0] as RibbonGroup, 0, measure) * 2 - 1;
    const [left, right] = planRibbonStages(twins, width, measure);
    expect(left).toBe(0);
    expect(right).toBeGreaterThan(0);
  });

  it("takes extra steps when the rendered row still overflows", () => {
    expect(planRibbonStages(groups, full, measure, 1)).not.toEqual([0, 0, 0, 0, 0]);
    expect(planRibbonStages(groups, full, measure, 999)).toEqual([3, 3, 3, 3, 3]);
    expect(ribbonStepCount(groups, measure)).toBeGreaterThanOrEqual(groups.length);
  });

  it("shrinks the gallery before folding its group", () => {
    const styles = groups[3] as RibbonGroup;
    expect(groupWidth(styles, 1, measure)).toBeLessThan(groupWidth(styles, 0, measure));
    const stages = planRibbonStages(groups, full - groupWidth(groups[4] as RibbonGroup, 0, measure), measure);
    expect(stages[3]).toBeGreaterThan(0);
    expect(stages[3]).toBeLessThan(3);
  });
});

describe("groupWidth constants", () => {
  const solo = (item: RibbonItem): RibbonGroup => ({ id: "g", labelKey: "", priority: 1, items: [item] });
  const combo = (width?: number) => ({ kind: "combo", id: "c", labelKey: "c", value: null, options: [], onChange: () => {}, width }) as RibbonItem;

  it("sizes a combo from 140 px by default and never below 56 px", () => {
    // 13 = group padding + separator, 2 = combo gap
    expect(groupWidth(solo(combo()), 0, measure)).toBe(140 + 2 + 13);
    expect(groupWidth(solo(combo(10)), 0, measure)).toBe(56 + 2 + 13);
  });

  it("packs 24 px icon buttons in 26 px cells", () => {
    const icons = [button("a", { size: "icon" }), button("b", { size: "icon" })];
    expect(groupWidth({ id: "g", labelKey: "", priority: 1, items: icons }, 0, measure)).toBe(26 * 2 + 13);
  });
});
