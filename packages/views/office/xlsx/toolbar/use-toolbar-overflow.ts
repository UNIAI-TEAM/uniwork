"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { selectVisibleGroupCount } from "./overflow-model";

/** The overflow trigger is `size="icon-sm"` (28px) plus the strip's `gap-1`.
 *  The shell owns that button, so reserving a constant keeps measurements
 *  stable between the pass before it mounts and the pass after. */
export const OVERFLOW_TRIGGER_WIDTH = 32;

/** `gap-1` between groups, counted into every measured group's footprint. */
const GROUP_GAP = 4;

export interface XlsxToolbarOverflow {
  containerRef: RefObject<HTMLDivElement | null>;
  /** Groups `[hiddenFrom, …)` go into the overflow panel. */
  hiddenFrom: number;
}

/** Measures the group strip and reports how many leading groups fit. Hidden
 *  panels (and jsdom, which has no layout) report width 0 and keep every group
 *  visible; widths are cached so a collapsed group can be unmounted and still
 *  count on the next resize. */
export function useToolbarOverflow(groupIds: readonly string[]): XlsxToolbarOverflow {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthsRef = useRef(new Map<string, number>());
  const [hiddenFrom, setHiddenFrom] = useState(groupIds.length);
  const idKey = groupIds.join("|");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;
    const ids = idKey === "" ? [] : idKey.split("|");
    const measure = () => {
      const available = container.clientWidth;
      if (available <= 0) return;
      for (const node of container.querySelectorAll<HTMLElement>("[data-xlsx-toolbar-group]")) {
        const id = node.dataset.xlsxToolbarGroup;
        const width = node.offsetWidth;
        if (id && width > 0) widthsRef.current.set(id, width);
      }
      const widths = ids.map((id) => (widthsRef.current.get(id) ?? 0) + GROUP_GAP);
      const next = selectVisibleGroupCount(widths, available, OVERFLOW_TRIGGER_WIDTH + GROUP_GAP);
      setHiddenFrom((current) => (current === next ? current : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, [idKey]);

  return { containerRef, hiddenFrom: Math.min(hiddenFrom, groupIds.length) };
}
