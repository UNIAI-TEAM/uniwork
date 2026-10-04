"use client";

import { Fragment } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
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

function Readout({ testId, text }: { testId: string; text: string }) {
  return (
    <span className="min-w-0 truncate" data-testid={testId}>
      {text}
    </span>
  );
}

/** A separator between readouts inside one cluster. */
function Dot() {
  return (
    <span aria-hidden="true" className="shrink-0 text-faint-foreground">
      {SEPARATOR}
    </span>
  );
}

/**
 * DOCX status row (28px, C10): the left cluster carries page x/y, word and
 * character counts and the document language; the right cluster carries the
 * active selection and the zoom mirror. Presentational - the wiring owns page,
 * zoom, language and selection and either feeds counts or hands over the
 * editor; every missing field renders the unknown mark, so the bar is safe to
 * mount before those surfaces exist.
 */
export function DocxStatusBar({ editor, counts, page, language, zoom, selection, className }: DocxStatusBarProps) {
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
  // The zoom template carries a trailing `%`, so an unknown value collapses to
  // the bare mark instead of rendering a dangling percent sign.
  const zoomText = zoomPercent === null ? unknown : t("office.docx.status.zoom", { percent: zoomPercent });
  // A collapsed caret is not a selection; Word's bar shows the range only.
  const hasSelection = Boolean(selection && selection.to > selection.from);

  const left: ReadonlyArray<{ testId: string; text: string }> = [
    { testId: "docx-status-page", text: pageText },
    { testId: "docx-status-words", text: t("office.docx.status.words", { value: countText(resolvedCounts?.words, unknown) }) },
    {
      testId: "docx-status-characters",
      text: t("office.docx.status.characters", { value: countText(resolvedCounts?.characters, unknown) }),
    },
    {
      testId: "docx-status-characters-no-spaces",
      text: t("office.docx.status.charactersNoSpaces", { value: countText(resolvedCounts?.charactersWithoutSpaces, unknown) }),
    },
    { testId: "docx-status-language", text: t("office.docx.status.language", { language: languageLabel ?? unknown }) },
  ];

  return (
    <div
      role="group"
      aria-label={t("office.docx.status.label")}
      // Counts change on every keystroke; a live region would read out each one.
      aria-live="off"
      data-testid="docx-status-bar"
      className={cn(
        "flex h-7 min-w-0 flex-nowrap items-center justify-between gap-x-3 overflow-hidden whitespace-nowrap px-2 text-caption text-muted-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-x-2" data-testid="docx-status-left">
        {left.map((item, index) => (
          <Fragment key={item.testId}>
            {index > 0 ? <Dot /> : null}
            <Readout testId={item.testId} text={item.text} />
          </Fragment>
        ))}
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-x-2" data-testid="docx-status-right">
        {hasSelection && selection ? (
          <>
            <Readout
              testId="docx-status-selection"
              text={t("office.docx.selection.range", { from: selection.from, to: selection.to })}
            />
            <Dot />
          </>
        ) : null}
        <Readout testId="docx-status-zoom" text={zoomText} />
      </div>
    </div>
  );
}
