"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { documentIconFormat, DocumentTypeIcon } from "./document-type-icon";
import { formatListDate } from "./doclist/format";
import type { LibraryRow } from "./library-rows";

/** The board shows one row of four cards. */
const CONTINUE_CARDS = 4;
const KNOWN_ACTIVITY = new Set(["edited", "opened", "commented"]);

interface ContinueCard {
  id: string;
  title: string;
  format: string;
  kind: string;
  at: string;
}

/**
 * The Mở tiếp cards of Gần đây (recent-canvas): the documents of the loaded
 * Recent list with the newest last activity first, whatever the table's sort,
 * at most four. No new request: a row without an activity stamp is left out.
 */
export function continueCards(rows: readonly LibraryRow[]): ContinueCard[] {
  const cards: ContinueCard[] = [];
  for (const row of rows) {
    if (row.type !== "document") continue;
    const activity = row.doc.last_activity;
    if (!activity?.at || !KNOWN_ACTIVITY.has(activity.kind) || Number.isNaN(Date.parse(activity.at))) continue;
    cards.push({ id: row.doc.id, title: row.doc.title, format: documentIconFormat(row.doc.kind, row.doc.title), kind: activity.kind, at: activity.at });
  }
  return cards.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, CONTINUE_CARDS);
}

interface RecentContinueProps {
  cards: readonly ContinueCard[];
  onOpen: (documentId: string) => void;
}

/** One row of document cards above the Recent toolbar; each card is a button that opens its document. */
export function RecentContinue({ cards, onOpen }: RecentContinueProps) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const now = new Date();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-body-lg font-semibold">
        {t("documents.recent.continue_title")}
      </h2>
      <div className="grid grid-cols-1 gap-3 min-[30rem]:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            data-document-id={card.id}
            onClick={() => onOpen(card.id)}
            className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background text-left transition-colors hover:bg-accent"
          >
            <span aria-hidden className="flex h-24 w-full justify-center bg-muted px-4 pt-4">
              <span className="flex w-[70%] flex-col gap-1.5 rounded-t-md bg-background p-3 shadow-sm">
                <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/40" />
                <span className="h-1 w-[88%] rounded-full bg-border" />
                <span className="h-1 w-[72%] rounded-full bg-border" />
                <span className="h-1 w-[80%] rounded-full bg-border" />
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-2.5 px-3.5 py-3">
              <DocumentTypeIcon format={card.format} decorative className="size-7 shrink-0" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-body font-medium text-foreground">{card.title}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {t("documents.recent.continue_when", {
                    activity: t(`documents.list.activity.${card.kind}`),
                    when: formatListDate(card.at, now, i18n.language, { yesterday: t("documents.list.date.yesterday") }),
                  })}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
