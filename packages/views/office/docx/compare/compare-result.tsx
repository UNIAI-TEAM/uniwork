"use client";

// C2 (UNI-924): the compare result list. Read-only presentation of the pure
// diff: unchanged runs collapse to a count, and every changed/added/removed
// block renders side-by-side with word-level highlighting inside changed
// pairs. No document content is ever written back anywhere.

import { useTranslation } from "react-i18next";
import { compareRows, summarizeCompare, type CompareEntry, type CompareWord } from "./diff";

function Words({ words }: { words: readonly CompareWord[] }) {
  return (
    <p className="whitespace-pre-wrap break-words text-body">
      {words.map((word, index) =>
        word.kind === "same" ? (
          <span key={`${index}:same`}>{word.text}</span>
        ) : (
          <span
            key={`${index}:${word.kind}`}
            data-compare-word={word.kind}
            className={
              word.kind === "removed"
                ? "rounded-xs bg-destructive-soft text-destructive-soft-foreground"
                : "rounded-xs bg-success-soft text-success-soft-foreground"
            }
          >
            {word.text}
          </span>
        ),
      )}
    </p>
  );
}

function CompareEntryRow({ entry }: { entry: CompareEntry }) {
  const { t } = useTranslation();
  const currentLabel = t("office.docx.compare.current");
  const comparedLabel = t("office.docx.compare.compared");
  const emptyLabel = t("office.docx.compare.empty");

  return (
    <li data-compare-entry={entry.kind} className="rounded-md border border-border bg-surface-raised p-2">
      <p className="mb-1 text-caption font-medium text-muted-foreground" data-testid={`docx-compare-kind-${entry.kind}`}>
        {t(`office.docx.compare.kind.${entry.kind}`)}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {entry.kind !== "added" ? (
          <section
            aria-label={currentLabel}
            data-compare-side="left"
            className={
              entry.kind === "removed"
                ? "rounded-sm bg-destructive-soft p-2 text-destructive-soft-foreground"
                : "rounded-sm bg-surface-hover p-2"
            }
          >
            <h4 className="sr-only">{currentLabel}</h4>
            {entry.leftWords ? <Words words={entry.leftWords} /> : <p className="whitespace-pre-wrap break-words text-body">{entry.left === "" ? emptyLabel : entry.left}</p>}
          </section>
        ) : null}
        {entry.kind !== "removed" ? (
          <section
            aria-label={comparedLabel}
            data-compare-side="right"
            className={
              entry.kind === "added"
                ? "rounded-sm bg-success-soft p-2 text-success-soft-foreground"
                : "rounded-sm bg-surface-hover p-2"
            }
          >
            <h4 className="sr-only">{comparedLabel}</h4>
            {entry.rightWords ? <Words words={entry.rightWords} /> : <p className="whitespace-pre-wrap break-words text-body">{entry.right === "" ? emptyLabel : entry.right}</p>}
          </section>
        ) : null}
      </div>
    </li>
  );
}

export interface DocxCompareResultProps {
  /** Display name of the compared file (never a host path). */
  fileName: string;
  entries: readonly CompareEntry[];
}

export function DocxCompareResult({ fileName, entries }: DocxCompareResultProps) {
  const { t } = useTranslation();
  const summary = summarizeCompare(entries);
  const total = summary.added + summary.removed + summary.changed;
  const rows = compareRows(entries);

  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="docx-compare-result">
      <p role="status" data-testid="docx-compare-summary" className="text-body">
        {total === 0
          ? t("office.docx.compare.identical")
          : t("office.docx.compare.summary", { added: summary.added, removed: summary.removed, changed: summary.changed })}
      </p>
      <p className="text-caption text-muted-foreground">{t("office.docx.compare.against", { name: fileName })}</p>
      <ul className="flex max-h-80 flex-col gap-2 overflow-auto pr-1" data-testid="docx-compare-rows">
        {rows.map((row, index) =>
          row.kind === "same" ? (
            <li key={`same-${index}`} className="text-caption text-muted-foreground" data-testid="docx-compare-same-run">
              {t("office.docx.compare.sameRun", { n: row.count })}
            </li>
          ) : (
            <CompareEntryRow key={`entry-${index}`} entry={row.entry} />
          ),
        )}
      </ul>
    </div>
  );
}
