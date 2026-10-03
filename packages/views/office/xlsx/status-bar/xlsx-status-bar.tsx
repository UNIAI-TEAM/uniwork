"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import type { XlsxSelection } from "../types";
import { useXlsxSelectionSummary, type XlsxSummaryState } from "./use-selection-summary";

interface XlsxStatusBarProps {
  documentKey: string;
  selection: XlsxSelection | null;
  host?: XlsxGridHostPort;
  /** The editor's dirty generation: an in-place edit re-reads the same selection. */
  dirtyGeneration?: number;
  className?: string;
}

function summaryContent(state: Extract<XlsxSummaryState, { kind: "ready" }>, locale: string, t: (key: string, options?: Record<string, unknown>) => string): ReactNode {
  const number = (value: number) => value.toLocaleString(locale);
  const { summary } = state;
  if (summary.kind === "numeric") {
    return (
      <>
        <span className="tabular-nums" data-testid="xlsx-status-bar-sum">{t("office.xlsx.statusBar.sum", { value: number(summary.sum) })}</span>
        <span className="tabular-nums" data-testid="xlsx-status-bar-average">{t("office.xlsx.statusBar.average", { value: number(summary.average) })}</span>
        <span className="tabular-nums" data-testid="xlsx-status-bar-count">{t("office.xlsx.statusBar.count", { value: number(summary.numericCount) })}</span>
        <span className="tabular-nums" data-testid="xlsx-status-bar-min">{t("office.xlsx.statusBar.min", { value: number(summary.min) })}</span>
        <span className="tabular-nums" data-testid="xlsx-status-bar-max">{t("office.xlsx.statusBar.max", { value: number(summary.max) })}</span>
      </>
    );
  }
  if (summary.kind === "count") {
    return <span className="tabular-nums" data-testid="xlsx-status-bar-count">{t("office.xlsx.statusBar.count", { value: number(summary.nonEmptyCount) })}</span>;
  }
  if (state.partial) {
    return <span data-testid="xlsx-status-bar-partial-empty">{t("office.xlsx.statusBar.partialEmpty")}</span>;
  }
  return <span data-testid="xlsx-status-bar-no-values">{t("office.xlsx.statusBar.noValues")}</span>;
}

/** Read-only selection statistics for the workbook, mounted below the grid in
 *  every mode: nothing selected, no renderer host, a read in flight and a
 *  failed read each get their own honest state, and a host that confirms only
 *  part of the range is called out instead of being read as a total. */
export function XlsxStatusBar({ documentKey, selection, host, dirtyGeneration, className }: XlsxStatusBarProps) {
  const { t, i18n } = useTranslation();
  const { state, pending } = useXlsxSelectionSummary({ documentKey, host, selection, dirtyGeneration });

  let content: ReactNode;
  switch (state.kind) {
    case "empty":
      content = <span data-testid="xlsx-status-bar-empty">{t("office.xlsx.statusBar.empty")}</span>;
      break;
    case "unavailable":
      content = <span data-testid="xlsx-status-bar-unavailable">{t("office.xlsx.statusBar.unavailable")}</span>;
      break;
    case "error":
      content = <span data-testid="xlsx-status-bar-error">{t("office.xlsx.statusBar.error")}</span>;
      break;
    case "loading":
      content = <span data-testid="xlsx-status-bar-calculating">{t("office.xlsx.statusBar.calculating")}</span>;
      break;
    case "ready":
      content = summaryContent(state, i18n.language, t);
      break;
  }

  return (
    <div
      className={cn("flex min-w-0 shrink-0 flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-border bg-muted/20 px-3 py-1 text-caption text-muted-foreground", className)}
      role="group"
      aria-label={t("office.xlsx.statusBar.label")}
      data-testid="xlsx-status-bar"
    >
      {content}
      {state.kind === "ready" && state.partial ? (
        <span className="rounded-sm bg-muted px-1.5 py-0.5" title={t("office.xlsx.statusBar.partialHint")} data-testid="xlsx-status-bar-partial">
          {t("office.xlsx.statusBar.partial")}{" "}
          <span className="sr-only">{t("office.xlsx.statusBar.partialHint")}</span>
        </span>
      ) : null}
      {state.kind === "ready" && pending ? (
        <span className="text-muted-foreground/70" data-testid="xlsx-status-bar-pending">{t("office.xlsx.statusBar.calculating")}</span>
      ) : null}
    </div>
  );
}
