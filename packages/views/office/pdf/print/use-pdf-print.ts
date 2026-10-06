"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPrintBusy, type OfficePrintPort } from "../../print";
import type { PdfCanvasPage, PdfPageRenderService } from "../canvas";
import { printPdfDocument } from "./print-document";
import type { PdfPrintImageInliner } from "./types";

/** What the print entries show after a run: nothing (printed or cancelled),
 * the neutral "a print dialog is already open" status, the shared too-large
 * error, or the generic error. */
type PdfPrintStatus = "busy" | "tooLarge" | "failed" | null;

export interface PdfPrintController {
  /** True while pages render and the host prints; both entries are disabled. */
  printing: boolean;
  status: PdfPrintStatus;
  /** Start a print run; ignored while one is running. Never retries by itself. */
  print(): void;
}

export interface UsePdfPrintOptions {
  /** The injected host print path; without one there is no Print entry. */
  port?: OfficePrintPort;
  /** The host page renderer; without one there is nothing to print. */
  renderer?: PdfPageRenderService;
  /** The document's pages at the moment Print is chosen. */
  getPages?(): readonly PdfCanvasPage[];
  title: string;
  lang?: string;
  inlineImage?: PdfPrintImageInliner;
}

/**
 * One print controller per PDF editor, shared by the toolbar button and the
 * header menu item so both run the SAME action and show the same busy state.
 * Returns null when the host gave no port or cannot render pages, so the view
 * renders no Print entry at all (never a dead control).
 */
export function usePdfPrint({ port, renderer, getPages, title, lang, inlineImage }: UsePdfPrintOptions): PdfPrintController | null {
  const [printing, setPrinting] = useState(false);
  const [status, setStatus] = useState<PdfPrintStatus>(null);
  const runningRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const latest = useRef({ port, renderer, getPages, title, lang, inlineImage });
  latest.current = { port, renderer, getPages, title, lang, inlineImage };

  // An unmounted editor (closed or switched document) abandons its render pass.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const print = useCallback(() => {
    const options = latest.current;
    if (runningRef.current || !options.port || !options.renderer || !options.getPages) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setPrinting(true);
    setStatus(null);
    void printPdfDocument({
      port: options.port,
      renderer: options.renderer,
      pages: options.getPages(),
      title: options.title,
      lang: options.lang,
      inlineImage: options.inlineImage,
      signal: controller.signal,
    }).then((outcome) => {
      if (controller.signal.aborted) return;
      // `cancelled` (dialog dismissed) is silent; busy is a neutral status.
      if (outcome.outcome === "failed") setStatus(isPrintBusy(outcome) ? "busy" : outcome.reason === "print_too_large" ? "tooLarge" : "failed");
    }).finally(() => {
      runningRef.current = false;
      if (controllerRef.current === controller) controllerRef.current = null;
      if (!controller.signal.aborted) setPrinting(false);
    });
  }, []);

  const available = Boolean(port && renderer && getPages);
  return useMemo(() => (available ? { printing, status, print } : null), [available, print, printing, status]);
}
