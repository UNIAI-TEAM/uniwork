"use client";

import { Fragment } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { docxEditorCounts } from "./status-counts";

/** Counts the wiring can precompute; a missing field renders the unknown mark. */
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

export interface DocxStatusBarProps {
  /** Live editor; counts are derived from it unless `counts` is supplied. */
  editor?: Editor | null;
  /** Precomputed counts from the wiring; wins over `editor` when present. */
  counts?: DocxStatusCounts | null;
  page?: DocxStatusPage | null;
  /** BCP-47 tag (`docxDocumentLang`); the bar shows the primary subtag. */
  language?: string | null;
  /** Zoom percentage (100 = 100%) mirrored from the view control. */
  zoom?: number | null;
  className?: string;
}

// Structural decoration between readouts, not copy.
const SEPARATOR = "\u00b7";

/** First subtag of a BCP-47 tag: `vi-VN` reads as `vi`; a blank tag has none. */
export function documentLanguageLabel(language: string | null | undefined): string | null {
  if (typeof language !== "string") return null;
  const primary = language.trim().replace(/_/g, "-").split("-")[0]?.toLowerCase() ?? "";
  return primary.length > 0 ? primary : null;
}

function countText(value: number | null | undefined, unknown: string): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : unknown;
}

function pageNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function zoomValue(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : null;
}

/**
 * DOCX status row: page x/y, word/character counts, document language and a
 * zoom mirror. Presentational — the wiring owns page, zoom and language and
 * either feeds counts or hands over the editor; every missing field renders
 * the unknown mark, so the bar is safe to mount before those surfaces exist.
 */
export function DocxStatusBar({ editor, counts, page, language, zoom, className }: DocxStatusBarProps) {
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

  const items: ReadonlyArray<{ testId: string; text: string }> = [
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
    { testId: "docx-status-zoom", text: t("office.docx.status.zoom", { percent: zoomPercent ?? unknown }) },
  ];

  return (
    <div
      role="group"
      aria-label={t("office.docx.status.label")}
      // Counts change on every keystroke; a live region would read out each one.
      aria-live="off"
      data-testid="docx-status-bar"
      className={cn(
        "flex min-w-0 flex-nowrap items-center gap-x-2 overflow-hidden whitespace-nowrap text-caption text-muted-foreground",
        className,
      )}
    >
      {items.map((item, index) => (
        <Fragment key={item.testId}>
          {index > 0 ? (
            <span aria-hidden="true" className="shrink-0 text-faint-foreground">
              {SEPARATOR}
            </span>
          ) : null}
          <span className="min-w-0 truncate" data-testid={item.testId}>
            {item.text}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
