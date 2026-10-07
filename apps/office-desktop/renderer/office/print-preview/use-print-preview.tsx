import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PrintPreviewDialog } from "./print-dialog";
import type { PrintPreviewBridge, PrintPreviewChoice, PrintPreviewHook, PrintPreviewJob } from "./types";

interface Pending {
  readonly id: number;
  readonly job: PrintPreviewJob;
  readonly resolve: (choice: PrintPreviewChoice) => void;
}

/**
 * The print dialog as a hook (UNI-961): `preview(job)` opens the dialog and
 * resolves with what the user chose when it closes; render `dialog` once,
 * anywhere in the tree.
 *
 * One job at a time: a call while a dialog is open resolves `cancel` for the
 * new job and leaves the open dialog alone (the user is mid-decision; the port
 * answers the second request exactly as if its dialog had been dismissed).
 * Without a bridge there is nothing to preview with, so the job resolves
 * `system`, the dialog the port opened before the preview existed. Unmounting
 * while a dialog is open resolves it `cancel`. `preview` keeps its identity for
 * as long as `bridge` does.
 *
 * The Dialog root stays mounted and is opened and closed by a flag, so Base UI
 * always runs its own close path (focus returns to what had focus when
 * `preview` was called, the page behind is released). The last job stays
 * rendered until that close has finished.
 */
export function usePrintPreview(bridge: PrintPreviewBridge | undefined): { preview: PrintPreviewHook; dialog: ReactNode } {
  const [shown, setShown] = useState<Pending | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // The ref answers "is one open?" synchronously; state alone lags a second call in the same tick.
  const open = useRef<Pending | null>(null);
  const nextId = useRef(0);
  const opener = useRef<HTMLElement | null>(null);

  const preview = useCallback<PrintPreviewHook>((job) => {
    if (!bridge) return Promise.resolve({ kind: "system" });
    if (open.current) return Promise.resolve({ kind: "cancel" });
    return new Promise<PrintPreviewChoice>((resolve) => {
      nextId.current += 1;
      const entry: Pending = { id: nextId.current, job, resolve };
      open.current = entry;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setShown(entry);
      setIsOpen(true);
    });
  }, [bridge]);

  const finish = useCallback((entry: Pending, choice: PrintPreviewChoice): void => {
    if (open.current !== entry) return;
    open.current = null;
    setIsOpen(false);
    entry.resolve(choice);
  }, []);

  useEffect(() => () => {
    const entry = open.current;
    open.current = null;
    entry?.resolve({ kind: "cancel" });
  }, []);

  const focusAfterClose = useCallback((): HTMLElement | null => (opener.current?.isConnected ? opener.current : null), []);
  // A close that finishes after the next job has already opened must not drop that one.
  const onClosed = useCallback((): void => { if (!open.current) setShown(null); }, []);

  const dialog = bridge ? <PrintPreviewDialog bridge={bridge} shell={{ open: isOpen, job: shown?.job ?? null, jobId: shown?.id ?? 0, focusAfterClose, onClosed }} onChoice={(choice) => { if (shown) finish(shown, choice); }} /> : null;
  return { preview, dialog };
}
