import { useSyncExternalStore } from "react";
import type { XlsxSelection } from "../types";

/**
 * The renderer port cannot read a cell's number format back, so the ribbon's
 * format box shows the LAST format applied from the ribbon to the selection
 * that is still selected (General otherwise). One entry is enough: it is only
 * trusted while the selection key still matches, and any other selection reads
 * as General - never a stale name for a different cell.
 */
let latest: { readonly key: string; readonly pattern: string } | null = null;
const listeners = new Set<() => void>();

/** `unit|sheet!range` - the identity an applied format is trusted for. */
export function appliedFormatKey(unitId: string | null | undefined, selection: XlsxSelection | null): string | null {
  if (!selection) return null;
  return `${unitId ?? ""}|${selection.sheet}!${selection.address}:${selection.endAddress ?? selection.address}`;
}

export function recordAppliedFormat(key: string | null, pattern: string): void {
  if (key === null) return;
  latest = { key, pattern };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The pattern last applied to the selection `key`, or null. */
export function useAppliedPattern(key: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (key !== null && latest?.key === key ? latest.pattern : null),
    () => null,
  );
}

/** Non-hook read of the same trusted entry (for command handlers). */
export function readAppliedPattern(key: string | null): string | null {
  return key !== null && latest?.key === key ? latest.pattern : null;
}
