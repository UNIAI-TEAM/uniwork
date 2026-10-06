import { useCallback, useEffect, useRef, useState } from "react";
import { rendererEditsToOperations, type XlsxGridEdit } from "./xlsx-edit-bridge";
import { isSnapshot } from "./xlsx-editor-model";
import type { XlsxGridHostPort } from "./xlsx-grid-surface";
import type { XlsxEditorHandle, XlsxSaveCoordinator } from "./types";

/** Apply grid mutations in order; Save waits for the same host edit queue. */
export function useXlsxGridEdits<TSnapshot>(
  documentKey: string,
  editor: XlsxEditorHandle<TSnapshot>,
  coordinator: XlsxSaveCoordinator,
  host: XlsxGridHostPort | undefined,
  canEdit: boolean,
  onApplied: () => void,
) {
  const pending = useRef(Promise.resolve());
  const session = useRef(0);
  // The batch queued behind the edit in flight, still open for more edits.
  const waiting = useRef<XlsxGridEdit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    session.current += 1;
    pending.current = Promise.resolve();
    waiting.current = null;
    setError(null);
    return () => { session.current += 1; };
  }, [documentKey, editor, coordinator, host]);

  const onEdits = useCallback((edits: XlsxGridEdit[]) => {
    if (!canEdit || !host || edits.length === 0) return;
    const generation = session.current;
    const captured = structuredClone(edits);
    // One grid command can emit dozens of batches at once (an Undo of a
    // Subtotal over file CF/DV rules: row removals, rule-set snapshots,
    // formula rewrites). Batches that arrive before the queue reaches them
    // join one ordered edit, so the editor publishes one snapshot and the
    // document is marked dirty once, instead of one React update per batch
    // (which hit React's nested-update limit, visual-final MAJOR 1). A batch
    // the engine refuses refuses the whole joined edit, earlier valid batches
    // included; the queue stops and the banner shows, as it did per batch.
    if (waiting.current) { waiting.current.push(...captured); return; }
    const batch = captured;
    waiting.current = batch;
    const next = pending.current.then(async () => {
      if (waiting.current === batch) waiting.current = null;
      if (session.current !== generation) return;
      const operations = rendererEditsToOperations(host.file.sheets, batch);
      await editor.edit?.(operations);
      if (session.current !== generation) return;
      coordinator.markDirty?.(editor.getDirtyGeneration());
      onApplied();
    });
    pending.current = next;
    void next.catch((failure: unknown) => {
      if (session.current === generation) setError(failure instanceof Error ? failure.message : String(failure));
    });
  }, [canEdit, coordinator, editor, host, onApplied]);

  const flush = useCallback(() => pending.current, []);
  // A Data tool plans from the values as of OK: the queued edits land first,
  // then the editor's snapshot is read; a failed edit rejects (review-design F3).
  const readLiveSnapshot = useCallback(async () => {
    await pending.current;
    const next = editor.getWorkbookSnapshot?.();
    return isSnapshot(next) ? next : null;
  }, [editor]);
  return { onEdits, flush, readLiveSnapshot, error };
}
