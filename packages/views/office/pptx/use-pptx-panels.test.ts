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
    const stamp = { slideIndex: 0, selectedIds: ["t1"] };
    expect(onCreated.mock.calls).toEqual([[["new-1"], stamp], [["new-2"], stamp]]);
  });

  it("stamps the slide and selection when the edit is SENT, not when it resolves (W10 review F3)", async () => {
    const onCreated = vi.fn();
    let finish: (value: unknown) => void = () => undefined;
    const applyEdit = vi.fn(() => new Promise<unknown>((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook((props: PptxPanelsInput) => usePptxPanels(props), {
      initialProps: { ...base, applyEdit, onCreated, activeTab: "insert" },
    });
    const bold = result.current.groupItems.font?.find((entry) => entry.id === "font-bold");
    if (!bold || !("onExecute" in bold)) throw new Error("no bold");
    act(() => bold.onExecute());
    // The user moves to another slide and selection while the edit is in flight.
    rerender({ ...base, applyEdit, onCreated, activeTab: "insert", slideIndex: 3, selectedIds: [] });
    await act(async () => { finish({ createdIds: ["new-1"] }); await Promise.resolve(); });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(["new-1"], { slideIndex: 0, selectedIds: ["t1"] });
  });

  const multi: PptxPanelsInput = {
    ...base,
    boxes: [{ sourceId: "t1", type: "text", box: box() }, { sourceId: "p1", type: "picture", box: box() }, { sourceId: "s2", type: "shape", box: box() }],
    selectedIds: ["t1", "p1", "s2"],
  };
  const press = (items: readonly RibbonItem[] | undefined, id: string) => {
    const item = items?.find((entry) => entry.id === id);
    if (!item || !("onExecute" in item)) throw new Error("no " + id);
    item.onExecute();
  };

  it("sends a multi-element format as ONE call on the array channel (W9 review F2)", async () => {
    const applyEdit = vi.fn(async (_edit: unknown) => undefined);
    const bulkEdit = vi.fn(async (_edits: readonly unknown[]) => ({ revision: 2 }));
    const { result } = renderHook(() => usePptxPanels({ ...multi, applyEdit, bulkEdit }));
    await act(async () => { press(result.current.groupItems.font, "font-bold"); await Promise.resolve(); });
    expect(bulkEdit).toHaveBeenCalledTimes(1);
    expect(bulkEdit).toHaveBeenCalledWith([
      { op: "set_font", slideIndex: 0, elementId: "t1", font: { bold: true } },
      { op: "set_font", slideIndex: 0, elementId: "s2", font: { bold: true } },
    ]);
    expect(applyEdit).not.toHaveBeenCalled();
  });

  it("keeps a single-element format on the host's single-edit port", async () => {
    const applyEdit = vi.fn(async (_edit: unknown) => undefined);
    const bulkEdit = vi.fn(async (_edits: readonly unknown[]) => ({ revision: 2 }));
    const { result } = renderHook(() => usePptxPanels({ ...base, applyEdit, bulkEdit }));
    await act(async () => { press(result.current.groupItems.font, "font-bold"); await Promise.resolve(); });
    expect(applyEdit).toHaveBeenCalledTimes(1);
    expect(bulkEdit).not.toHaveBeenCalled();
  });

  it("falls back to ordered single calls when only the single-edit port is bound", async () => {
    const applyEdit = vi.fn(async (_edit: unknown) => undefined);
    const { result } = renderHook(() => usePptxPanels({ ...multi, applyEdit }));
    await act(async () => { press(result.current.groupItems.font, "font-bold"); await Promise.resolve(); await Promise.resolve(); });
    expect(applyEdit.mock.calls.map(([edit]) => (edit as { elementId: string }).elementId)).toEqual(["t1", "s2"]);
  });
});
