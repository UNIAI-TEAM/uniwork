import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PrintPreviewDialog } from "./print-dialog";
import type { PrintPreviewBridge, PrintPreviewChoice, PrintPreviewHook, PrintPreviewJob } from "./types";

interface Pending {
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
 */
export function usePrintPreview(bridge: PrintPreviewBridge | undefined): { preview: PrintPreviewHook; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  // The ref answers "is one open?" synchronously; state alone lags a second call in the same tick.
  const open = useRef<Pending | null>(null);

  const preview = useCallback<PrintPreviewHook>((job) => {
    if (!bridge) return Promise.resolve({ kind: "system" });
    if (open.current) return Promise.resolve({ kind: "cancel" });
    return new Promise<PrintPreviewChoice>((resolve) => {
      const entry: Pending = { job, resolve };
      open.current = entry;
      setPending(entry);
    });
  }, [bridge]);

  const finish = useCallback((entry: Pending, choice: PrintPreviewChoice): void => {
    if (open.current !== entry) return;
    open.current = null;
    setPending(null);
    entry.resolve(choice);
  }, []);

  useEffect(() => () => {
    const entry = open.current;
    open.current = null;
    entry?.resolve({ kind: "cancel" });
  }, []);

  const dialog = pending && bridge ? <PrintPreviewDialog bridge={bridge} job={pending.job} onChoice={(choice) => finish(pending, choice)} /> : null;
  return { preview, dialog };
}
