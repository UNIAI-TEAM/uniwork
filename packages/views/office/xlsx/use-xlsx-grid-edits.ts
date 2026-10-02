import { useCallback, useEffect, useRef, useState } from "react";
import { rendererEditsToOperations, type XlsxGridCellEdit } from "./xlsx-edit-bridge";
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
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    session.current += 1;
    pending.current = Promise.resolve();
    setError(null);
    return () => { session.current += 1; };
  }, [documentKey]);

  const onEdits = useCallback((edits: XlsxGridCellEdit[]) => {
    if (!canEdit || !host || edits.length === 0) return;
    const generation = session.current;
    const captured = structuredClone(edits);
    const next = pending.current.then(async () => {
      if (session.current !== generation) return;
      const operations = rendererEditsToOperations(host.file.sheets, captured);
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
  return { onEdits, flush, error };
}
