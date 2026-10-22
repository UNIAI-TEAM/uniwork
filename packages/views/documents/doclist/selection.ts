import { useState } from "react";

// The bulk selection of one document list (UNI-2045 W9). Local React state on
// purpose: it belongs to the table on screen, nothing else reads it, and it
// must not outlive the screen, folder, workspace or filter it was made on, so
// a core store would only add a reset to keep in step.

export interface DocListSelection {
  /** The selected ids still on screen, in list order. */
  ids: string[];
  isSelected: (id: string) => boolean;
  /** Toggles one row; with `range`, every row from the last toggled one takes the new state. */
  toggle: (id: string, range: boolean) => void;
  /** The header checkbox: on selects every selectable loaded row, off clears. */
  setAll: (on: boolean) => void;
  clear: () => void;
  /** The header checkbox state. */
  all: boolean | "mixed";
}

/**
 * `selectable` is the selectable rows on screen in display order; a selected
 * id that left the list (after a batch, a refetch) drops out on its own.
 * A new `resetKey` (screen, folder, workspace, filters) starts empty.
 */
export function useDocListSelection(selectable: readonly string[], resetKey: string): DocListSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [key, setKey] = useState(resetKey);
  // The row a shift-click ranges from: the last one toggled.
  const [anchor, setAnchor] = useState<string | null>(null);
  let current = selected;
  if (key !== resetKey) {
    setKey(resetKey);
    current = new Set();
    setSelected(current);
    setAnchor(null);
  }
  const ids = selectable.filter((id) => current.has(id));

  const toggle = (id: string, range: boolean) => {
    const on = !current.has(id);
    const next = new Set(ids);
    const from = range && anchor ? selectable.indexOf(anchor) : -1;
    const to = selectable.indexOf(id);
    const span = from >= 0 && to >= 0 ? selectable.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
    for (const each of span) {
      if (on) next.add(each);
      else next.delete(each);
    }
    setAnchor(id);
    setSelected(next);
  };

  return {
    ids,
    isSelected: (id) => current.has(id),
    toggle,
    setAll: (on) => {
      setAnchor(null);
      setSelected(on ? new Set(selectable) : new Set());
    },
    clear: () => {
      setAnchor(null);
      setSelected(new Set());
    },
    all: ids.length === 0 ? false : ids.length === selectable.length ? true : "mixed",
  };
}
