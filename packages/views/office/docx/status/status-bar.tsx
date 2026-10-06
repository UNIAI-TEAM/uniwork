"use client";

import { Fragment, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { Maximize, MoveHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { OfficeStatusActions, OfficeStatusBar, OfficeStatusZoom } from "../../frame/office-status-bar";
import { docxEditorCounts } from "./status-counts";

/**
 * Counts the wiring can precompute. Each field must be a whole number >= 0;
 * missing, negative, fractional and non-finite values render the unknown mark.
 */
export interface DocxStatusCounts {
  words?: number | null;
  characters?: number | null;
  charactersWithoutSpaces?: number | null;
}

/** Page position the wiring measured; a missing side renders the unknown mark. */
export interface DocxStatusPage {
  current?: number | null;
  total?: number | null;
}

/** The caret/selection range the wiring reports (M-1 / C10). */
export interface DocxStatusSelection {
  from: number;
  to: number;
}

export interface DocxStatusBarProps {
  /** Live editor; counts are derived from it unless `counts` is supplied. */
  editor?: Editor | null;
  /** Precomputed counts from the wiring; wins over `editor` when present. */
  counts?: DocxStatusCounts | null;
  page?: DocxStatusPage | null;
  /** BCP-47 tag (`docxDocumentLang`); the bar shows the primary subtag. */
  language?: string | null;
  /** Whole zoom percentage > 0 (100 = 100%); anything else renders the unknown mark. */
  zoom?: number | null;
  /** The active selection; a collapsed caret renders no selection readout. */
  selection?: DocxStatusSelection | null;
  /** Zoom step controls (C10). The wiring hands over the shared controller's
   *  own step functions; absent keeps the readout text-only. */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  /** View buttons (Word's page width / whole page); each shows only when the wiring supplies it. */
  onFitWidth?: () => void;
  onFitPage?: () => void;
  /** The shortcuts-help trigger; always the last item of the row (F9). */
  help?: ReactNode;
  className?: string;
}

// Structural decoration between readouts, not copy.
const SEPARATOR = "\u00b7";
// A well-formed primary subtag: 2-8 ASCII letters (the BCP-47 language range).
const LANGUAGE_SUBTAG_RE = /^[a-zA-Z]{2,8}$/;

/** First subtag of a BCP-47 tag: `vi-VN` reads as `vi`; malformed tags have no label. */
export function documentLanguageLabel(language: string | null | undefined): string | null {
  if (typeof language !== "string") return null;
  const primary = language.trim().replace(/_/g, "-").split("-")[0] ?? "";
  return LANGUAGE_SUBTAG_RE.test(primary) ? primary.toLowerCase() : null;
}

/** Whole, non-negative counts only; fractional, negative and non-finite are unknown. */
function countText(value: number | null | undefined, unknown: string): string {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : unknown;
}

function pageNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** Whole, positive percentages only; 0% and fractional zoom are meaningless. */
function zoomValue(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? String(value) : null;
}

function Readout({ testId, text, className }: { testId: string; text: string; className?: string }) {
  return (
    <span className={cn("min-w-0 truncate", className)} data-testid={testId}>
      {text}
    </span>
  );
}

/**
 * DOCX status row (28px, C10): the left cluster carries page x/y, word and
 * character counts and the document language; the right cluster carries the
 * active selection (count + range) and the zoom step control. Presentational -
 * the wiring owns page, zoom, language and selection and either feeds counts or
 * hands over the editor; every missing field renders the unknown mark, so the
 * bar is safe to mount before those surfaces exist.
 */
export function DocxStatusBar({ editor, counts, page, language, zoom, selection, onZoomIn, onZoomOut, onFitWidth, onFitPage, help, className }: DocxStatusBarProps) {
  const { t } = useTranslation();
  const unknown = t("office.docx.status.unknown");
  const resolvedCounts = counts ?? (editor ? docxEditorCounts(editor) : null);
  const current = pageNumber(page?.current);
  const total = pageNumber(page?.total);
  const zoomPercent = zoomValue(zoom);
  const languageLabel = documentLanguageLabel(language);
  const pageText =
    current === null && total === null
      ? unknown
      : t("office.docx.status.page", {
          current: current === null ? unknown : String(current),
          total: total === null ? unknown : String(total),
        });
  // A collapsed caret is not a selection; Word's bar shows the count and range only.
  const hasSelection = Boolean(selection && selection.to > selection.from);

  // `hide` drops the lower-priority readouts first as the row narrows.
  const left: ReadonlyArray<{ testId: string; text: string; hide?: string }> = [
    { testId: "docx-status-page", text: pageText },
    { testId: "docx-status-words", text: t("office.docx.status.words", { value: countText(resolvedCounts?.words, unknown) }) },
    {
      testId: "docx-status-characters",
      text: t("office.docx.status.characters", { value: countText(resolvedCounts?.characters, unknown) }),
      hide: "max-sm:hidden",
    },
    {
      testId: "docx-status-characters-no-spaces",
      text: t("office.docx.status.charactersNoSpaces", { value: countText(resolvedCounts?.charactersWithoutSpaces, unknown) }),
      hide: "max-lg:hidden",
    },
    { testId: "docx-status-language", text: t("office.docx.status.language", { language: languageLabel ?? unknown }), hide: "max-sm:hidden" },
  ];

  return (
    // The wrapper only carries the live-region opt-out and the test id; the
    // row itself is the shared OfficeStatusBar.
    <div className={cn("contents", className)} data-testid="docx-status-bar" aria-live="off">
      <OfficeStatusBar
        labelKey="office.docx.status.label"
        start={
          <div className="flex min-w-0 items-center gap-x-2" data-testid="docx-status-left">
            {left.map((item, index) => (
              <Fragment key={item.testId}>
                {index > 0 ? <span aria-hidden="true" className={cn("shrink-0 text-faint-foreground", item.hide)}>{SEPARATOR}</span> : null}
                <Readout testId={item.testId} text={item.text} className={item.hide} />
              </Fragment>
            ))}
          </div>
        }
        end={
          <div className="flex min-w-0 shrink-0 items-center gap-x-2" data-testid="docx-status-right">
            {hasSelection && selection ? (
              <>
                <Readout
                  testId="docx-status-selection-count"
                  text={t("office.docx.selection.count", { value: selection.to - selection.from })}
                  className="max-md:hidden"
                />
                <span aria-hidden="true" className="shrink-0 text-faint-foreground max-md:hidden">{SEPARATOR}</span>
                <Readout
                  testId="docx-status-selection"
                  text={t("office.docx.selection.range", { from: selection.from, to: selection.to })}
                />
              </>
            ) : null}
            <OfficeStatusActions
              label={t("office.status.viewLabel")}
              actions={[
                ...(onFitWidth ? [{ id: "fit-width", label: t("office.status.fitWidth"), icon: <MoveHorizontal aria-hidden />, onClick: onFitWidth }] : []),
                ...(onFitPage ? [{ id: "fit-page", label: t("office.status.fitPage"), icon: <Maximize aria-hidden />, onClick: onFitPage }] : []),
              ]}
            />
            <div data-testid="docx-status-zoom-control">
              <span data-testid="docx-status-zoom" className="contents">
                <OfficeStatusZoom
                  value={zoomPercent === null ? null : Number(zoomPercent)}
                  onZoomIn={onZoomIn}
                  onZoomOut={onZoomOut}
                />
              </span>
            </div>
          </div>
        }
        help={help}
      />
    </div>
  );
}
