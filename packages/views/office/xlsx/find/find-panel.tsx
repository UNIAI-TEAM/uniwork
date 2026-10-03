"use client";

// Wave A / A4 (UNI-926): the find & replace panel. It is mounted by the XLSX
// editor (not by the toolbar group) because its kind of work needs the
// renderer host for bounded cell reads; the Home-tab group only opens it.

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, CaseSensitive, Replace, ReplaceAll } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import type { XlsxToolbarCommands } from "../toolbar/types";
import type { XlsxSelection } from "../types";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { FIND_REPLACE_OP_LIMIT } from "./find-match";
import { useXlsxFindReplace, type XlsxFindController } from "./use-find-replace";

export interface XlsxFindPanelProps {
  documentKey: string;
  host: XlsxGridHostPort;
  commands: XlsxToolbarCommands;
  selection: XlsxSelection | null;
  /** The active sheet's name; the scan targets it. */
  sheetName: string | null;
  dirtyGeneration?: number;
  readOnly?: boolean;
  onClose: () => void;
}

function statusText(t: (key: string, options?: Record<string, unknown>) => string, find: XlsxFindController): string {
  switch (find.scan.kind) {
    case "loading":
      return t("office.xlsx.find.status.reading");
    case "unavailable":
      return t("office.xlsx.find.status.unavailable");
    case "error":
      return t("office.xlsx.find.status.error");
    default:
      break;
  }
  if (!find.queryActive) return t("office.xlsx.find.status.typeQuery");
  if (find.matchCount === 0) return t("office.xlsx.find.status.noMatches");
  if (find.currentIndex >= 0) {
    return t("office.xlsx.find.status.position", { index: find.currentIndex + 1, count: find.matchCount });
  }
  return t("office.xlsx.find.status.matches", { count: find.matchCount });
}

function actionMessage(
  t: (key: string, options?: Record<string, unknown>) => string,
  find: XlsxFindController,
): { tone: "status" | "alert"; testId: string; content: ReactNode } | null {
  switch (find.action.kind) {
    case "replaced":
      return { tone: "status", testId: "xlsx-find-replaced", content: t("office.xlsx.find.status.replaced") };
    case "replacedAll":
      return find.action.count === 0
        ? { tone: "status", testId: "xlsx-find-replaced-none", content: t("office.xlsx.find.status.noChange") }
        : {
            tone: "status",
            testId: "xlsx-find-replaced-all",
            content: t("office.xlsx.find.status.replacedAll", { count: find.action.count }),
          };
    case "limit":
      return {
        tone: "alert",
        testId: "xlsx-find-limit",
        content: t("office.xlsx.find.status.limit", { limit: FIND_REPLACE_OP_LIMIT, count: find.action.count }),
      };
    case "failed":
      return { tone: "alert", testId: "xlsx-find-failed", content: t("office.xlsx.find.status.failed") };
    default:
      return null;
  }
}

/** Find & replace over a bounded read window of the active sheet. The default
 *  scope is the current selection (cheap, exact); "whole sheet" scans the
 *  used window and states honestly when the host could only serve part of it.
 *  Replace writes go through `sheet.command.set-range-values`, the same
 *  allowlisted cell-edit path manual typing uses, so they journal and save
 *  like any other edit. Formula cells are matched on their displayed value
 *  but never replaced — a value write would be recalculated away. */
export function XlsxFindPanel({
  documentKey,
  host,
  commands,
  selection,
  sheetName,
  dirtyGeneration = 0,
  readOnly = false,
  onClose,
}: XlsxFindPanelProps) {
  const { t } = useTranslation();
  const find = useXlsxFindReplace({ documentKey, host, commands, selection, sheetName, dirtyGeneration, readOnly });
  const formulaMatches = find.matchCount - find.replaceableCount;
  const message = actionMessage(t, find);
  const partial = find.scan.kind === "ready" && find.scan.partial ? find.scan : null;

  return (
    <Dialog
      open
      modal={false}
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="xlsx-find-panel"
        overlayClassName="pointer-events-none bg-transparent backdrop-blur-none"
        className="top-20 right-4 left-auto translate-x-0 translate-y-0 sm:max-w-sm"
        closeLabel={t("office.xlsx.find.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("office.xlsx.find.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <label className="text-caption font-medium" htmlFor="xlsx-find-query">
            {t("office.xlsx.find.findLabel")}
          </label>
          <Input
            id="xlsx-find-query"
            data-testid="xlsx-find-query"
            className="h-8"
            autoFocus
            value={find.query}
            onChange={(event) => find.changeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              find.findNext();
            }}
          />
          <label className="text-caption font-medium" htmlFor="xlsx-find-replacement">
            {t("office.xlsx.find.replaceLabel")}
          </label>
          <Input
            id="xlsx-find-replacement"
            data-testid="xlsx-find-replacement"
            className="h-8"
            value={find.replacement}
            onChange={(event) => find.changeReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              find.replace();
            }}
          />
          <div role="group" aria-label={t("office.xlsx.find.options")} className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t("office.xlsx.find.matchCase")}
              aria-pressed={find.matchCase}
              data-testid="xlsx-find-match-case"
              onClick={() => find.changeMatchCase(!find.matchCase)}
            >
              <CaseSensitive aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={find.scope === "selection"}
              aria-disabled={selection === null || undefined}
              data-testid="xlsx-find-scope-selection"
              onClick={() => {
                if (selection) find.changeScope("selection");
              }}
            >
              {t("office.xlsx.find.scopeSelection")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={find.scope === "sheet"}
              data-testid="xlsx-find-scope-sheet"
              onClick={() => find.changeScope("sheet")}
            >
              {t("office.xlsx.find.scopeSheet")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={!find.canFind || undefined}
              data-testid="xlsx-find-previous"
              onClick={() => find.findPrevious()}
            >
              <ArrowUp aria-hidden />
              {t("office.xlsx.find.previous")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={!find.canFind || undefined}
              data-testid="xlsx-find-next"
              onClick={() => find.findNext()}
            >
              <ArrowDown aria-hidden />
              {t("office.xlsx.find.next")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={!find.canReplace || undefined}
              data-testid="xlsx-find-replace"
              onClick={() => find.replace()}
            >
              <Replace aria-hidden />
              {t("office.xlsx.find.replace")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={!find.canReplaceAll || undefined}
              data-testid="xlsx-find-replace-all"
              onClick={() => find.replaceAll()}
            >
              <ReplaceAll aria-hidden />
              {t("office.xlsx.find.replaceAll")}
            </Button>
          </div>
          <p
            role="status"
            aria-live="polite"
            data-testid="xlsx-find-status"
            className="text-caption text-muted-foreground"
          >
            {statusText(t, find)}
          </p>
          {find.pending && find.scan.kind === "ready" ? (
            <p className="text-caption text-muted-foreground" data-testid="xlsx-find-pending">
              {t("office.xlsx.find.status.reading")}
            </p>
          ) : null}
          {partial ? (
            <p className="text-caption text-muted-foreground" data-testid="xlsx-find-partial">
              {t("office.xlsx.find.status.partial", { scanned: partial.scannedRows, total: partial.totalRows })}
            </p>
          ) : null}
          {formulaMatches > 0 ? (
            <p className="text-caption text-muted-foreground" data-testid="xlsx-find-formula-hint">
              {t("office.xlsx.find.status.formulaHint", { count: formulaMatches })}
            </p>
          ) : null}
          {message ? (
            <p
              role={message.tone}
              className={message.tone === "alert" ? "text-caption text-destructive" : "text-caption text-muted-foreground"}
              data-testid={message.testId}
            >
              {message.content}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
