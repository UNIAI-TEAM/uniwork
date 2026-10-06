"use client";

// UNI-952 (D-xlsx): the one XLSX print path. The Page Setup group's Print
// button and the page header's overflow-menu item both call `print`, which
// collects the active sheet, builds the copy (./print-copy) and hands it to
// the INJECTED port - never `window.print()` on the app window. Outcomes:
// `cancelled` is silent, a busy dialog shows the neutral "already open"
// status, any other failure the generic error. No automatic retry; a second
// request while one is pending is ignored. No port means no entry at all.

import { Printer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { XlsxPageSetupFields, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { createBrowserPrintPort, isPrintBusy, type OfficePrintOutcome, type OfficePrintPort } from "../../print";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { collectXlsxPrintSheet } from "./collect";
import type { XlsxPrintGrid } from "./collect-live";
import { buildXlsxPrintCopy } from "./print-copy";

const XLSX_PRINT_KEYS = {
  menuItem: "office.common.print",
  busy: "office.xlsx.print.busy",
  failed: "office.xlsx.print.failed",
  tooLarge: "office.xlsx.print.tooLarge",
} as const;

type XlsxPrintNotice = "busy" | "failed" | "tooLarge";

/** How long a print notice stays before it clears itself. */
const NOTICE_MS = 6000;

interface XlsxPrintRunInput {
  readonly port: OfficePrintPort;
  readonly host: XlsxGridHostPort;
  readonly sheetName: string;
  readonly sheetId?: string | undefined;
  readonly snapshot: XlsxWorkbookSnapshot | null;
  readonly grid?: XlsxPrintGrid | null | undefined;
  readonly session?: XlsxPageSetupFields | undefined;
  readonly title: string;
  readonly locale?: string | undefined;
}

/** Collect, build and print one sheet. A throwing step becomes a typed failure. */
export async function runXlsxPrint(input: XlsxPrintRunInput): Promise<OfficePrintOutcome> {
  try {
    const collected = await collectXlsxPrintSheet(input);
    if (!collected.ok) return { outcome: "failed", reason: collected.reason };
    const copy = buildXlsxPrintCopy(collected.sheet);
    if (!copy.ok) return { outcome: "failed", reason: copy.reason };
    return await input.port.print({ html: copy.html, title: input.title });
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

export interface XlsxPrintOptions {
  /** Undefined = the web browser port; null = the host cannot print. */
  readonly port: OfficePrintPort | null | undefined;
  readonly host: XlsxGridHostPort | undefined;
  /** The active sheet's live name. */
  readonly sheetName: string | null;
  readonly resolveSheetId?: ((sheetName: string) => string | undefined) | undefined;
  readonly getSnapshot?: (() => XlsxWorkbookSnapshot | null) | undefined;
  readonly getGrid?: (() => XlsxPrintGrid | null) | undefined;
  /** The unsaved Page Setup edits applied to a sheet this session, by the
   *  sheet's grid id (its live name when the grid has no id for it). */
  readonly getSession?: ((sheetKey: string) => XlsxPageSetupFields | undefined) | undefined;
  readonly title: string;
}

interface XlsxPrintWiring {
  /** Absent when there is no port or no mounted workbook. */
  print: (() => void) | undefined;
  /** The overflow-menu item (null without `print`). */
  menuItem: ReactNode;
  /** The polite outcome line; render it once inside the editor. */
  notice: ReactNode;
}

export function useXlsxPrint(options: XlsxPrintOptions): XlsxPrintWiring {
  const { t, i18n } = useTranslation();
  const port = useMemo(() => (options.port === undefined ? createBrowserPrintPort() : options.port), [options.port]);
  const [notice, setNotice] = useState<XlsxPrintNotice | null>(null);
  const pending = useRef(false);
  const latest = useRef(options);
  latest.current = options;

  const run = useCallback(async () => {
    const current = latest.current;
    if (!port || !current.host || !current.sheetName || pending.current) return;
    pending.current = true;
    setNotice(null);
    try {
      const sheetName = current.sheetName;
      const sheetId = current.resolveSheetId?.(sheetName);
      const outcome = await runXlsxPrint({
        port,
        host: current.host,
        sheetName,
        sheetId,
        snapshot: current.getSnapshot?.() ?? null,
        grid: current.getGrid?.() ?? null,
        session: current.getSession?.(sheetId ?? sheetName),
        title: current.title,
        locale: i18n.language,
      });
      if (outcome.outcome === "failed") {
        setNotice(isPrintBusy(outcome) ? "busy" : outcome.reason === "print_too_large" ? "tooLarge" : "failed");
      }
    } finally {
      pending.current = false;
    }
  }, [i18n, port]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const available = Boolean(port && options.host);
  const print = useMemo(() => (available ? () => { void run(); } : undefined), [available, run]);

  const menuItem = useMemo(() => (print ? (
    <DropdownMenuItem className="gap-2 px-2 py-2" data-testid="xlsx-header-print" onClick={print}>
      <Printer aria-hidden className="size-3.5" />
      {t(XLSX_PRINT_KEYS.menuItem)}
    </DropdownMenuItem>
  ) : null), [print, t]);

  const noticeNode = (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-12 z-50 flex justify-center px-4">
      {notice ? (
        <p
          data-testid="xlsx-print-notice"
          data-print-notice={notice}
          className="max-w-md rounded-md border border-border bg-popover px-3 py-2 text-caption text-popover-foreground shadow-md"
        >
          {t(XLSX_PRINT_KEYS[notice])}
        </p>
      ) : null}
    </div>
  );

  return { print, menuItem, notice: noticeNode };
}
