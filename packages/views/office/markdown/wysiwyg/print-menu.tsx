"use client";

/**
 * The Markdown print entries for the page overflow (⋯) menu (M8, chrome C4).
 *
 * Two things live here and nothing else:
 *
 *   * "Print" - when the host injected a print port. The click renders the
 *     current document, sanitizes it (see print.ts) and hands the copy to the
 *     port. The view never calls `window.print()` and never passes the raw
 *     source.
 *   * "Export PDF" / "Export DOCX" - DISABLED, each with a "not available
 *     yet" tooltip. The engine path for these is G2-07 pending, so the entry
 *     is honest about not existing rather than faking a download.
 *
 * The entries are menu items, not floating buttons over the canvas (C9), so
 * they mount into the page's ⋯ menu through the header menu slot.
 */
import { useCallback, useId, useState } from "react";
import { FileDown, FileText, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import type { AssetManifest } from "@uniwork/office-engine/assets";
import { printMarkdownDocument, type MarkdownPrintOutcome, type MarkdownPrintPort } from "./print";

/** i18next keys this module reads. All exist today (see the MISSING KEYS list). */
export const MARKDOWN_PRINT_KEYS = {
  print: "office.markdown.print.title",
  exportPdf: "office.markdown.print.exportPdf",
  exportDocx: "office.markdown.print.exportDocx",
  exportNotAvailable: "office.markdown.print.exportNotAvailable",
} as const;

export interface MarkdownPrintMenuItemsProps {
  /**
   * The host print path. Absent means the host cannot print this format, so
   * the Print entry is not offered at all (never a dead button).
   */
  port?: MarkdownPrintPort;
  /** Renders the CURRENT document to HTML - the preview render, injected by
   * the host so this view never builds a preview of its own. */
  renderHtml: () => string;
  /** Accessible document title, for the printed page. */
  title: string;
  /** The preview's asset manifest; local references are neutralised without one. */
  manifest?: AssetManifest;
  /** The scoped proxy URL for a manifest key, or null when not granted. */
  assetUrl?(key: string): string | null;
  /** Reports the port's outcome so the caller can toast on failure. */
  onOutcome?(outcome: MarkdownPrintOutcome): void;
}

/** The two exports whose engine path (G2-07) has not landed: disabled + tooltip. */
const DISABLED_EXPORTS = [
  { id: "pdf", icon: FileDown, labelKey: MARKDOWN_PRINT_KEYS.exportPdf },
  { id: "docx", icon: FileText, labelKey: MARKDOWN_PRINT_KEYS.exportDocx },
] as const;

/**
 * The ⋯-menu entries. A disabled export keeps its reason on the item's
 * `title` and in an `sr-only` note wired with `aria-describedby`, so the
 * reason is reachable by pointer and by screen reader.
 */
export function MarkdownPrintMenuItems({
  port,
  renderHtml,
  title,
  manifest,
  assetUrl,
  onOutcome,
}: MarkdownPrintMenuItemsProps) {
  const { t } = useTranslation();
  const [printing, setPrinting] = useState(false);
  const reasonId = useId();

  const print = useCallback(async () => {
    if (!port || printing) return;
    setPrinting(true);
    try {
      const outcome = await printMarkdownDocument({ port, renderHtml, title, manifest, assetUrl });
      onOutcome?.(outcome);
    } finally {
      setPrinting(false);
    }
  }, [assetUrl, manifest, onOutcome, port, printing, renderHtml, title]);

  return (
    <>
      {port ? (
        <DropdownMenuItem
          className="gap-2 px-2 py-2"
          data-markdown-print
          aria-busy={printing || undefined}
          aria-disabled={printing || undefined}
          onClick={() => {
            if (printing) return;
            void print();
          }}
        >
          <Printer aria-hidden className="size-3.5" />
          {t(MARKDOWN_PRINT_KEYS.print)}
        </DropdownMenuItem>
      ) : null}
      {DISABLED_EXPORTS.map(({ id, icon: Icon, labelKey }) => (
        <DropdownMenuItem
          key={id}
          className="gap-2 px-2 py-2"
          data-markdown-export={id}
          disabled
          title={t(MARKDOWN_PRINT_KEYS.exportNotAvailable)}
          aria-describedby={reasonId}
        >
          <Icon aria-hidden className="size-3.5" />
          {t(labelKey)}
        </DropdownMenuItem>
      ))}
      <span id={reasonId} className="sr-only">
        {t(MARKDOWN_PRINT_KEYS.exportNotAvailable)}
      </span>
    </>
  );
}
