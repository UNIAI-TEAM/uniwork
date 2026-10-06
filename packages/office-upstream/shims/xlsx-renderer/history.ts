// UNI-953 item 9: the ribbon's Undo/Redo need an empty-stack state. Univer's
// undo/redo service already publishes the focused unit's stack sizes on
// every push, undo, redo and focus change; this mirrors the latest status
// for the host and notifies its listeners.
import { IUndoRedoService } from "@univerjs/core";

/** Undo and redo entries on the focused workbook's stack. */
export interface XlsxRendererHistoryState {
  undos: number;
  redos: number;
}

interface UndoRedoStatusSource {
  undoRedoStatus$?: { subscribe?(next: (status: XlsxRendererHistoryState) => void): { unsubscribe(): void } };
}

export interface XlsxRendererHistoryWatch {
  /** Null when the runtime publishes no status: the host keeps Undo/Redo on. */
  get(): XlsxRendererHistoryState | null;
  subscribe(listener: (state: XlsxRendererHistoryState) => void): () => void;
  dispose(): void;
}

export function watchUndoHistory(source: UndoRedoStatusSource | null | undefined): XlsxRendererHistoryWatch {
  let state: XlsxRendererHistoryState | null = null;
  const listeners = new Set<(state: XlsxRendererHistoryState) => void>();
  const subscription = source?.undoRedoStatus$?.subscribe?.((status) => {
    const next = { undos: Math.max(0, Number(status?.undos) || 0), redos: Math.max(0, Number(status?.redos) || 0) };
    if (state !== null && next.undos === state.undos && next.redos === state.redos) return;
    state = next;
    for (const listener of [...listeners]) listener({ ...next });
  });
  return {
    get: () => (state === null ? null : { ...state }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      subscription?.unsubscribe();
      listeners.clear();
    },
  };
}

/** The renderer's watch, read from the Univer injector. */
export function watchRendererHistory(injector: { get(token: typeof IUndoRedoService): unknown }): XlsxRendererHistoryWatch {
  let source: unknown;
  try {
    source = injector.get(IUndoRedoService);
  } catch {
    source = null;
  }
  return watchUndoHistory(source as UndoRedoStatusSource | null);
}
