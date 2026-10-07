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
import { useCallback, useId, useSyncExternalStore } from "react";
import { FileDown, FileText, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import type { AssetManifest } from "@uniwork/office-engine/assets";
import { useOfficePrintShortcut } from "../../print/shortcut";
import { printMarkdownDocument, type MarkdownPrintOutcome, type MarkdownPrintPort } from "./print";

/** i18next keys this module reads. All exist in `en.json` / `vi.json`. */
export const MARKDOWN_PRINT_KEYS = {
  print: "office.common.print",
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
  /** CSP written into the copy. Pass one naming the asset proxy origin when
   * `manifest`/`assetUrl` are set, or the rewritten URLs self-block. Defaults
   * to {@link PRINT_COPY_CSP}. */
  csp?: string;
  /** A print run starts: the caller clears the previous outcome notice. */
  onStart?(): void;
  /** Reports the port's outcome so the caller can show it (the menu closes on click). */
  onOutcome?(outcome: MarkdownPrintOutcome): void;
}

/** The two exports whose engine path (G2-07) has not landed: disabled + tooltip. */
const DISABLED_EXPORTS = [
  { id: "pdf", icon: FileDown, labelKey: MARKDOWN_PRINT_KEYS.exportPdf },
  { id: "docx", icon: FileText, labelKey: MARKDOWN_PRINT_KEYS.exportDocx },
] as const;

/**
 * "A run is in flight" for one print port. The menu entry (mounted only while
 * the menu is open) and the Ctrl/Cmd+P binding are separate components over the
 * same port, so the flag lives per port and both read it: a run started from
 * either blocks the other until it settles.
 */
interface PrintGate {
  busy: boolean;
  listeners: Set<() => void>;
}
const printGates = new WeakMap<MarkdownPrintPort, PrintGate>();
const NO_PRINT_GATE: PrintGate = { busy: false, listeners: new Set() };

function gateFor(port: MarkdownPrintPort | undefined): PrintGate {
  if (!port) return NO_PRINT_GATE;
  let gate = printGates.get(port);
  if (!gate) {
    gate = { busy: false, listeners: new Set() };
    printGates.set(port, gate);
  }
  return gate;
}

function setBusy(gate: PrintGate, busy: boolean): void {
  gate.busy = busy;
  gate.listeners.forEach((listener) => listener());
}

/** One print run: render, sanitize, hand to the port, report the outcome. */
function useMarkdownPrint({ port, renderHtml, title, manifest, assetUrl, csp, onStart, onOutcome }: MarkdownPrintMenuItemsProps) {
  const gate = gateFor(port);
  const subscribe = useCallback((listener: () => void) => {
    gate.listeners.add(listener);
    return () => { gate.listeners.delete(listener); };
  }, [gate]);
  const printing = useSyncExternalStore(subscribe, () => gate.busy, () => false);
  const print = useCallback(async () => {
    // Read the gate, not the rendered state: two triggers in one tick start one run.
    if (!port || gate.busy) return;
    setBusy(gate, true);
    onStart?.();
    try {
      const outcome = await printMarkdownDocument({ port, renderHtml, title, manifest, assetUrl, csp });
      onOutcome?.(outcome);
    } finally {
      setBusy(gate, false);
    }
  }, [assetUrl, csp, gate, manifest, onOutcome, onStart, port, renderHtml, title]);
  return { print, printing };
}

/**
 * Binds Ctrl/Cmd+P (the Office shell's listener, UNI-952) to the same print
 * the menu entry runs. Mount it beside the menu contribution with the same
 * props: the menu items only exist while the menu is open. Renders nothing.
 */
export function MarkdownPrintShortcut(props: MarkdownPrintMenuItemsProps) {
  const { print } = useMarkdownPrint(props);
  useOfficePrintShortcut(props.port ? () => { void print(); } : null);
  return null;
}

/**
 * The ⋯-menu entries. A disabled export keeps its reason on the item's
 * `title` and in an `sr-only` note wired with `aria-describedby`, so the
 * reason is reachable by pointer and by screen reader.
 */
export function MarkdownPrintMenuItems(props: MarkdownPrintMenuItemsProps) {
  const { port } = props;
  const { t } = useTranslation();
  const { print, printing } = useMarkdownPrint(props);
  const reasonId = useId();

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
