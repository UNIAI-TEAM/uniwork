"use client";

import { useEffect, useState, type RefObject } from "react";
import type { XlsxGridHandle, XlsxGridHistoryState } from "./xlsx-grid-surface";

/** UNI-953 item 9: the grid's undo/redo stack sizes, updated on every
 *  command (push, undo, redo). Null while the grid is not ready or when the
 *  renderer has no history port: the ribbon then keeps its old behaviour. */
export function useXlsxHistoryState(
  gridRef: RefObject<Pick<XlsxGridHandle, "getHistory" | "subscribeHistory"> | null>,
  gridReady: boolean,
): XlsxGridHistoryState | null {
  const [state, setState] = useState<XlsxGridHistoryState | null>(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (!gridReady || !grid?.getHistory || !grid.subscribeHistory) {
      setState(null);
      return;
    }
    const initial = grid.getHistory();
    setState(initial === null ? null : { undos: initial.undos, redos: initial.redos, dropped: initial.dropped ?? 0 });
    return grid.subscribeHistory((next) => setState({ undos: next.undos, redos: next.redos, dropped: next.dropped ?? 0 }));
  }, [gridRef, gridReady]);
  return state;
}
