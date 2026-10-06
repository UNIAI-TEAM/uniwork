"use client";

/**
 * The PPTX Print entry point (UNI-952): one function behind the ribbon Print / Export PDF
 * commands AND the page header's overflow-menu item, so both places run the same print.
 *
 * Outcomes follow the shared Office print contract: `printed` and `cancelled` are silent,
 * `print_busy` (a dialog is already open) shows a neutral status, and any other failure is
 * reported as the generic action error. The run is awaited, never retried.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { isPrintBusy, type OfficePrintPort } from "../../print";
import type { PptxDeckRenderer } from "../canvas/deck-renderer";
import { collectPptxPrintSlides } from "./pptx-print";
import { createCanvasSlideRasterizer } from "./pptx-print-raster";
import { printPptxDeck, type PptxSlideRasterizer } from "./pptx-print-run";

/** The shared overflow-menu label every Office format uses for Print. */
const PRINT_MENU_LABEL_KEY = "office.common.print";

interface UsePptxPrintOptions {
  /** The host print port; absent/null hides every Print entry. */
  port: OfficePrintPort | null | undefined;
  /** The loaded deck renderer; no renderer, nothing to print yet. */
  renderer: PptxDeckRenderer | null;
  /** Slide views in deck order; a `hidden` slide is not printed (PowerPoint's default). */
  slides: readonly { hidden?: boolean }[];
  /** Document title for the print job and the default PDF file name. */
  title?: string;
  /** Commits an open in-place text edit before the copy is built. */
  flush(): Promise<unknown> | null | undefined;
  /** Reports a failed run (a translated message) as the editor's generic action error. */
  onFailed(error: Error): void;
  /** Over-cap raster fallback; defaults to the canvas rasterizer. */
  rasterize?: PptxSlideRasterizer | null;
}

interface PptxPrintController {
  /** The port when printing is possible now, else null (commands hidden). */
  port: OfficePrintPort | null;
  run(): void;
  /** A run is building or printing its copy; the entries show busy and refuse a second click. */
  pending: boolean;
  /** The neutral "already open" status, while it applies. */
  notice: ReactElement | null;
  /** The overflow-menu Print item, or null with no port. */
  menuItems: ReactElement | null;
}

export function usePptxPrint(options: UsePptxPrintOptions): PptxPrintController {
  const { t } = useTranslation();
  const { port: hostPort, renderer, slides, title, flush, onFailed, rasterize } = options;
  const port = hostPort && renderer ? hostPort : null;
  const [busy, setBusy] = useState(false);
  // The ref guards a double click within one render; the state drives the busy UI.
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  // The latest slide views, read at run time so a fresh `slides` array does not rebuild the menu item.
  const slidesRef = useRef(slides);
  useEffect(() => { slidesRef.current = slides; }, [slides]);
  const rasterizer = useMemo(() => (rasterize === undefined ? createCanvasSlideRasterizer() : rasterize), [rasterize]);

  const run = useCallback(() => {
    if (!port || !renderer || running.current) return;
    running.current = true;
    setPending(true);
    setBusy(false);
    const print = async () => {
      const printed = collectPptxPrintSlides(renderer, {
        skip: (index) => slidesRef.current[index]?.hidden === true,
        title: (index) => t("office.pptx.print.slide_label", { index: index + 1 }),
      });
      const name = title?.trim() || t("office.pptx.print.title");
      const outcome = await printPptxDeck({ port, slides: printed, title: name, rasterize: rasterizer });
      if (outcome.outcome !== "failed") return;
      if (isPrintBusy(outcome)) setBusy(true);
      else onFailed(new Error(t(outcome.reason === "print_too_large" ? "office.pptx.print.too_large" : "office.pptx.print.failed")));
    };
    // A failed text commit is reported like any other failed run: the user asked to print.
    const commit = flush();
    void (commit ? commit.then(print) : print())
      .catch(() => onFailed(new Error(t("office.pptx.print.failed"))))
      .finally(() => { running.current = false; setPending(false); });
  }, [flush, onFailed, port, rasterizer, renderer, t, title]);

  const notice = busy ? (
    <Alert key="print-busy" className="rounded-none border-x-0 border-t-0" role="status" data-testid="pptx-print-busy">
      <AlertDescription>{t("office.pptx.print.busy")}</AlertDescription>
    </Alert>
  ) : null;

  const menuItems = useMemo(() => (port ? (
    <DropdownMenuItem className="gap-2 px-2 py-2" data-pptx-print aria-disabled={pending || undefined} aria-busy={pending || undefined} onClick={run}>
      <Printer aria-hidden className="size-3.5" />
      {t(PRINT_MENU_LABEL_KEY)}
    </DropdownMenuItem>
  ) : null), [pending, port, run, t]);

  return { port, run, pending, notice, menuItems };
}
