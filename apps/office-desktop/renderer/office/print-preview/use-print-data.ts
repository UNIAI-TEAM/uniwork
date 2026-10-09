import { useEffect, useRef, useState } from "react";
import type { DesktopPrinter, DesktopPrintGeometry } from "../../../shared/ipc";
import { loadPreviewDocument, loadPrinters, type PreviewDocument, type PreviewOutcome } from "./preview-source";
import type { PrintPreviewBridge, PrintPreviewJob } from "./types";

/** Re-lay-out waits this long after the last orientation or paper change, so
 * flicking through the paper list asks main for one PDF, not six. */
export const PREVIEW_DEBOUNCE_MS = 300;

/** Main answers `print_busy` while another preview is being laid out; one retry after this wait. */
export const PREVIEW_BUSY_RETRY_MS = 400;

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

/** A layout the dialog wants: the copy at one sheet, asked through one bridge. */
interface Want {
  readonly bridge: PrintPreviewBridge;
  readonly job: PrintPreviewJob;
  readonly geometry: DesktopPrintGeometry;
}

/** Layout bookkeeping that outlives a render. Main lays out one preview at a
 * time and answers `print_busy` to a second request, so requests are
 * serialised here: `desired` is what the dialog shows now, `queued` the latest
 * wanted sheet not yet sent, `flying` whether a request is out. */
interface Runner {
  live: boolean;
  started: boolean;
  flying: boolean;
  desired: Want | null;
  queued: Want | null;
  current: PreviewDocument | null;
}

function sameWant(a: Want | null, b: Want | null): boolean {
  if (!a || !b) return false;
  return a.bridge === b.bridge && a.job === b.job && a.geometry.landscape === b.geometry.landscape
    && a.geometry.pageSize.width === b.geometry.pageSize.width && a.geometry.pageSize.height === b.geometry.pageSize.height;
}

/** One layout; when main still answers `print_busy` (another document's
 * preview holds its slot), one more try after a short wait. */
async function layOut(runner: Runner, want: Want): Promise<PreviewOutcome> {
  const wanted = (): boolean => runner.live && sameWant(want, runner.desired);
  let outcome = await loadPreviewDocument(want.bridge, want.job, want.geometry);
  if (outcome.kind === "failed" && outcome.reason === "print_busy" && wanted()) {
    await new Promise<void>((resolve) => { setTimeout(resolve, PREVIEW_BUSY_RETRY_MS); });
    if (wanted()) outcome = await loadPreviewDocument(want.bridge, want.job, want.geometry);
  }
  return outcome;
}

/** Send the queued sheet, and when it settles keep going while a newer one is
 * queued. An answer for a sheet nobody wants any more is dropped (its engine
 * copy freed), so the dialog only ever shows the latest sheet's preview. */
async function pump(runner: Runner, apply: (outcome: PreviewOutcome) => void): Promise<void> {
  if (runner.flying) return;
  runner.flying = true;
  try {
    while (runner.live && runner.queued) {
      const want = runner.queued;
      runner.queued = null;
      const outcome = await layOut(runner, want);
      if (!runner.live || !sameWant(want, runner.desired)) {
        if (outcome.kind === "ready") outcome.document.close();
        continue;
      }
      if (sameWant(runner.queued, want)) runner.queued = null;
      runner.current?.close();
      runner.current = outcome.kind === "ready" ? outcome.document : null;
      apply(outcome);
    }
  } finally {
    runner.flying = false;
  }
}

/**
 * The preview PDF of `job` at `geometry`, opened in the engine. The first
 * layout starts at once; a later change of orientation or paper is debounced.
 * Only one layout is in flight at a time (main's is single-flight): a change
 * made meanwhile waits for it, and only the latest sheet is then sent. The
 * previous document stays on screen (`busy`) until the new one is ready, and
 * is closed the moment it is replaced, when the dialog goes away, or when an
 * answer arrives for a sheet that was superseded.
 */
export function usePreviewDocument(bridge: PrintPreviewBridge, job: PrintPreviewJob, geometry: DesktopPrintGeometry): { state: PreviewState; busy: boolean } {
  const [state, setState] = useState<PreviewState>({ phase: "preparing" });
  const [busy, setBusy] = useState(true);
  const runnerRef = useRef<Runner | null>(null);
  runnerRef.current ??= { live: true, started: false, flying: false, desired: null, queued: null, current: null };
  const runner = runnerRef.current;
  const { landscape } = geometry;
  const { width, height } = geometry.pageSize;

  useEffect(() => {
    const want: Want = { bridge, job, geometry: { landscape, pageSize: { width, height } } };
    runner.desired = want;
    setBusy(true);
    const timer = setTimeout(() => {
      runner.started = true;
      runner.queued = want;
      void pump(runner, (outcome) => {
        setState(outcome.kind === "ready" ? { phase: "ready", document: outcome.document } : { phase: "failed", reason: outcome.reason });
        setBusy(false);
      });
    }, runner.started ? PREVIEW_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [runner, bridge, job, landscape, width, height]);

  useEffect(() => {
    runner.live = true;
    return () => {
      runner.live = false;
      runner.current?.close();
      runner.current = null;
    };
  }, [runner]);

  return { state, busy };
}
