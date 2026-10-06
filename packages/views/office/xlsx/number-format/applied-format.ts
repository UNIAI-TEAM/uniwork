import { useSyncExternalStore } from "react";
import type { XlsxSelection } from "../types";

/**
 * The renderer port cannot read a cell's number format back, so the ribbon's
 * format box shows the LAST format applied from the ribbon to the selection
 * that is still selected (General otherwise). One entry is enough: it is only
 * trusted while the selection key still matches, and any other selection reads
 * as General - never a stale name for a different cell. The entry is kept per
 * open document (UNI-957): the document key, never the workbook's content
 * hash, so two tabs holding the same bytes keep their own entry, and closing
 * the document drops it (forgetAppliedFormat).
 */
const latest = new Map<string, { readonly key: string; readonly pattern: string }>();
const listeners = new Set<() => void>();

const KEY_SEPARATOR = "|";

/** `document|sheet!range` - the identity an applied format is trusted for;
 *  null without a document or a selection. */
export function appliedFormatKey(documentKey: string | null | undefined, selection: XlsxSelection | null): string | null {
  if (!selection || !documentKey) return null;
  return `${encodeURIComponent(documentKey)}${KEY_SEPARATOR}${selection.sheet}!${selection.address}:${selection.endAddress ?? selection.address}`;
}

/** The document a key belongs to (encoded, so it never contains the separator). */
const documentOf = (key: string): string => key.slice(0, key.indexOf(KEY_SEPARATOR));

function notify(): void {
  for (const listener of listeners) listener();
}

export function recordAppliedFormat(key: string | null, pattern: string): void {
  if (key === null) return;
  latest.set(documentOf(key), { key, pattern });
  notify();
}

/** Drops a closed document's entry. */
export function forgetAppliedFormat(documentKey: string): void {
  if (latest.delete(encodeURIComponent(documentKey))) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function trusted(key: string | null): string | null {
  if (key === null) return null;
  const entry = latest.get(documentOf(key));
  return entry?.key === key ? entry.pattern : null;
}

/** The pattern last applied to the selection `key`, or null. */
export function useAppliedPattern(key: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => trusted(key),
    () => null,
  );
}

/** Non-hook read of the same trusted entry (for command handlers). */
export function readAppliedPattern(key: string | null): string | null {
  return trusted(key);
}
