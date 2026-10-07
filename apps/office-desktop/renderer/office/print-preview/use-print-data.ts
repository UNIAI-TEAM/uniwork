import { useEffect, useRef, useState } from "react";
import type { DesktopPrinter, DesktopPrintGeometry } from "../../../shared/ipc";
import { loadPreviewDocument, loadPrinters, type PreviewDocument } from "./preview-source";
import type { PrintPreviewBridge, PrintPreviewJob } from "./types";

/** Re-lay-out waits this long after the last orientation or paper change, so
 * flicking through the paper list asks main for one PDF, not six. */
export const PREVIEW_DEBOUNCE_MS = 300;

export type PrintersState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly printers: readonly DesktopPrinter[] }
  | { readonly phase: "error" };

/** The OS printers, read once when the dialog opens. */
export function usePrinters(bridge: PrintPreviewBridge): PrintersState {
  const [state, setState] = useState<PrintersState>({ phase: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadPrinters(bridge).then(
      (printers) => { if (!cancelled) setState({ phase: "ready", printers }); },
      () => { if (!cancelled) setState({ phase: "error" }); },
    );
    return () => { cancelled = true; };
  }, [bridge]);
  return state;
}

export type PreviewState =
  | { readonly phase: "preparing" }
  | { readonly phase: "ready"; readonly document: PreviewDocument }
  | { readonly phase: "failed"; readonly reason: string };

/**
 * The preview PDF of `job` at `geometry`, opened in the engine. The first
 * layout starts at once; a later change of orientation or paper is debounced.
 * The previous document stays on screen (`busy`) until the new one is ready,
 * and is closed the moment it is replaced, when the dialog goes away, or when
 * an answer arrives after a newer request superseded it.
 */
export function usePreviewDocument(bridge: PrintPreviewBridge, job: PrintPreviewJob, geometry: DesktopPrintGeometry): { state: PreviewState; busy: boolean } {
  const [state, setState] = useState<PreviewState>({ phase: "preparing" });
  const [busy, setBusy] = useState(true);
  const current = useRef<PreviewDocument | null>(null);
  const started = useRef(false);
  const { landscape } = geometry;
  const { width, height } = geometry.pageSize;

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      started.current = true;
      void loadPreviewDocument(bridge, job, { landscape, pageSize: { width, height } }).then((outcome) => {
        if (cancelled) {
          if (outcome.kind === "ready") outcome.document.close();
          return;
        }
        current.current?.close();
        if (outcome.kind === "ready") {
          current.current = outcome.document;
          setState({ phase: "ready", document: outcome.document });
        } else {
          current.current = null;
          setState({ phase: "failed", reason: outcome.reason });
        }
        setBusy(false);
      });
    }, started.current ? PREVIEW_DEBOUNCE_MS : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bridge, job, landscape, width, height]);

  useEffect(() => () => {
    current.current?.close();
    current.current = null;
  }, []);

  return { state, busy };
}
