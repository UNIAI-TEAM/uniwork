import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RibbonItem, RibbonMenuEntry } from "../ribbon/types";
import { box } from "./canvas/pptx-render-fixtures";
import { usePptxPanels, type PptxPanelsInput } from "./use-pptx-panels";

const base: PptxPanelsInput = {
  activeTab: "home",
  contextual: undefined,
  onError: vi.fn(),
  slideIndex: 0,
  slides: [{ id: "s1" }],
  boxes: [{ sourceId: "t1", type: "text", box: box() }],
  selectedIds: ["t1"],
  rendition: null,
};

function moreColors(items: readonly RibbonItem[] | undefined): RibbonMenuEntry {
  const color = items?.find((entry) => "menu" in entry && entry.menu.some((row) => row.id === "font-color-more"));
  if (!color || !("menu" in color)) throw new Error("no font colour menu");
  return color.menu.find((row) => row.id === "font-color-more") as RibbonMenuEntry;
}

describe("usePptxPanels (UNI-927 W9)", () => {
  it("never opens the text-format panel from More colors without an edit channel (W5 review F5)", () => {
    const { result } = renderHook(() => usePptxPanels(base));
    const more = moreColors(result.current.groupItems.font);
    expect(more.disabled).toBe(true);
    act(() => more.onSelect());
    expect(result.current.activeKind).toBeNull();
  });

  it("opens the text-format panel from More colors when an edit channel is bound", () => {
    const { result } = renderHook(() => usePptxPanels({ ...base, applyEdit: async () => undefined }));
    act(() => moreColors(result.current.groupItems.font).onSelect());
    expect(result.current.activeKind).toBe("text-format");
  });

  it("reports the ids an edit minted, and nothing for an edit that minted none", async () => {
    const onCreated = vi.fn();
    const results: unknown[] = [{ revision: 2, createdIds: ["new-1"] }, { createdId: "new-2" }, { revision: 3 }, undefined];
    const applyEdit = vi.fn(async () => results.shift());
    const { result } = renderHook(() => usePptxPanels({ ...base, applyEdit, onCreated, activeTab: "insert" }));
    const bold = result.current.groupItems.font?.find((entry) => entry.id === "font-bold");
    if (!bold || !("onExecute" in bold)) throw new Error("no bold");
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { bold.onExecute(); await Promise.resolve(); });
    }
    expect(applyEdit).toHaveBeenCalledTimes(4);
    expect(onCreated.mock.calls).toEqual([[["new-1"]], [["new-2"]]]);
  });
});
