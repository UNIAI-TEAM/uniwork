"use client";

/**
 * The Markdown / HTML print outcome line (UNI-952). The Print entry lives in a
 * dropdown that closes on click, so the editor itself owns the outcome: a
 * polite status that survives on both hosts (no toast provider assumed).
 * `cancelled` is silent, `print_busy` / `print_timeout` show the neutral
 * "already open" line, any other failure the generic one; the next print and
 * a timer clear it.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isPrintBusy } from "../../print";
import type { MarkdownPrintOutcome } from "./print";

export type PrintNoticeKind = "busy" | "failed";

/** How long a print notice stays before it clears itself. */
const NOTICE_MS = 6000;

const NOTICE_KEYS = {
  busy: "office.markdown.print.busy",
  failed: "office.markdown.print.failed",
} as const;

export function usePrintNotice() {
  const [notice, setNotice] = useState<PrintNoticeKind | null>(null);
  const onStart = useCallback(() => setNotice(null), []);
  const onOutcome = useCallback((outcome: MarkdownPrintOutcome) => {
    if (outcome.outcome !== "failed") setNotice(null);
    else setNotice(isPrintBusy(outcome) ? "busy" : "failed");
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return { notice, onStart, onOutcome };
}

export function PrintNotice({ notice }: { notice: PrintNoticeKind | null }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-12 z-50 flex justify-center px-4">
      {notice ? (
        <p
          data-print-notice={notice}
          className="max-w-md rounded-md border border-border bg-popover px-3 py-2 text-caption text-popover-foreground shadow-md"
        >
          {t(NOTICE_KEYS[notice])}
        </p>
      ) : null}
    </div>
  );
}
