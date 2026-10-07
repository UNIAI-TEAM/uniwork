// UNI-953 item 9: the ribbon's Undo/Redo need an empty-stack state. Univer's
// undo/redo service publishes the focused unit's stack sizes on every push,
// undo, redo and focus change; this mirrors the workbook's stacks for the host
// and notifies its listeners. While a cell edit is open the focused unit is
// the editor's document, so the sizes are read per unit from the pinned
// LocalUndoRedoService when it has them (review r3 F3c), and the entries its
// capped stack drops from the bottom are counted (F3a): the host orders its
// own visual history by the workbook depth, and a drop shifts that depth.
import { IUndoRedoService } from "@univerjs/core";

/** Undo and redo entries on the workbook's stack, and how many old entries
 *  the full stack has dropped since the renderer mounted (monotonic). */
export interface XlsxRendererHistoryState {
  undos: number;
  redos: number;
  dropped: number;
}

interface UndoRedoStatusSource {
  undoRedoStatus$?: { subscribe?(next: (status: { undos?: unknown; redos?: unknown }) => void): { unsubscribe(): void } };
  pushUndoRedo?: (item: { unitID?: string }) => void;
  _undoStacks?: Map<string, readonly unknown[]>;
  _redoStacks?: Map<string, readonly unknown[]>;
}

export interface XlsxRendererHistoryWatch {
  /** Null when the runtime publishes no status: the host keeps Undo/Redo on. */
  get(): XlsxRendererHistoryState | null;
  subscribe(listener: (state: XlsxRendererHistoryState) => void): () => void;
  dispose(): void;
}

const count = (value: unknown): number => Math.max(0, Number(value) || 0);

export function watchUndoHistory(source: UndoRedoStatusSource | null | undefined, unitId?: () => string | null | undefined): XlsxRendererHistoryWatch {
  let state: XlsxRendererHistoryState | null = null;
  let dropped = 0;
  const listeners = new Set<(state: XlsxRendererHistoryState) => void>();
  const unit = () => unitId?.() ?? null;
  const stacks = (id: string | null) =>
    id !== null && source?._undoStacks instanceof Map && source._redoStacks instanceof Map
      ? { undo: source._undoStacks.get(id) ?? [], redo: source._redoStacks.get(id) ?? [] }
      : null;
  const publish = (status: { undos?: unknown; redos?: unknown } | undefined) => {
    const own = stacks(unit());
    const next = own
      ? { undos: own.undo.length, redos: own.redo.length, dropped }
      : { undos: count(status?.undos), redos: count(status?.redos), dropped };
    if (state !== null && next.undos === state.undos && next.redos === state.redos && next.dropped === state.dropped) return;
    state = next;
    for (const listener of [...listeners]) listener({ ...next });
  };
  // A push onto the full workbook stack leaves its size alone but drops the
  // oldest entry: the top changes while the length does not (the status the
  // push itself emits is then a repeat, so the drop is published after it).
  // A batched push folds into the top entry, which stays the same object.
  const target = source as Record<string, unknown> | null | undefined;
  const push = source?.pushUndoRedo;
  const hadOwn = target ? Object.prototype.hasOwnProperty.call(target, "pushUndoRedo") : false;
  const own = target?.pushUndoRedo;
  if (target && typeof push === "function") {
    target.pushUndoRedo = function (this: unknown, item: { unitID?: string }) {
      const id = unit();
      const before = item?.unitID === id ? stacks(id)?.undo : undefined;
      const length = before?.length ?? 0;
      const top = before?.at(-1);
      push.call(this ?? source, item);
      const after = before ? stacks(id)?.undo : undefined;
      if (after && length > 0 && after.length === length && after.at(-1) !== top) {
        dropped += 1;
        publish(undefined);
      }
    };
  }
  const subscription = source?.undoRedoStatus$?.subscribe?.((status) => publish(status));
  return {
    get: () => (state === null ? null : { ...state }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      subscription?.unsubscribe();
      listeners.clear();
      if (target && typeof push === "function") {
        if (hadOwn) target.pushUndoRedo = own;
        else delete target.pushUndoRedo;
      }
    },
  };
}

/** The renderer's watch, read from the Univer injector; `unitId` names the
 *  workbook whose stacks it reports. */
export function watchRendererHistory(injector: { get(token: typeof IUndoRedoService): unknown }, unitId?: () => string | null | undefined): XlsxRendererHistoryWatch {
  let source: unknown;
  try {
    source = injector.get(IUndoRedoService);
  } catch {
    source = null;
  }
  return watchUndoHistory(source as UndoRedoStatusSource | null, unitId);
}
