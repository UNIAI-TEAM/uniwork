"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "@uniwork/core/types/people";
import { LIST_GRID_BOTTOM_CLEARANCE } from "@uniwork/ui/components/ui/list-grid";
import { PeopleCardsSkeleton } from "./people-skeleton";
import { CARD_GAP_REM, PersonCard, PERSON_CARD_HEIGHT_REM } from "./person-card";
import {
  useLoadMoreWhenAtEnd,
  useScrollViewport,
  useWindowedRows,
} from "./use-people-virtualizer";
import { useRemPx } from "./use-rem-px";

/**
 * The card grid — the view the directory opens on.
 *
 * Column count comes from the measured width of the scroll pane rather than
 * from viewport breakpoints, so the grid is right inside a split pane too. The
 * same measurement gives the windowing its row size, which is why row gap is
 * paid as padding inside each cell: a CSS `row-gap` would sit between rows and
 * put every spacer height off by one gap. Every size is in rem and turned
 * into pixels at the reader's text size, so a larger text setting gives fewer,
 * taller cards instead of overlapping ones.
 *
 * The grid carries list semantics by hand. Only a band of cards is in the DOM
 * at any time, so each one states its place and the size of the whole
 * directory as the server counts it — not the pages loaded so far; without that a screen reader would report the window as the list.
 */

const CARD_MIN_WIDTH_REM = 14.5;
const GRID_PADDING_TOP_REM = 1;
const MAX_COLUMNS = 4;

/** How many cards fit across `width` pixels, at least one and at most four. */
export function columnsForWidth(width: number, remPx = 16): number {
  if (width <= 0) return 1;
  const gap = CARD_GAP_REM * remPx;
  const fits = Math.floor((width + gap) / (CARD_MIN_WIDTH_REM * remPx + gap));
  return Math.min(MAX_COLUMNS, Math.max(1, fits));
}

export function PeopleCards({
  people,
  total,
  hrefFor,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onChat,
}: {
  people: Person[];
  /** How many people the whole directory (under the current filters) holds. */
  total: number;
  hrefFor: (userId: string) => string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onChat: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useScrollViewport(scrollRef);
  const remPx = useRemPx();
  const gap = CARD_GAP_REM * remPx;
  const rowHeight = (PERSON_CARD_HEIGHT_REM + CARD_GAP_REM) * remPx;
  const paddingTop = GRID_PADDING_TOP_REM * remPx;
  const columns = columnsForWidth(viewport.size.width, remPx);
  const rowCount = Math.ceil(people.length / columns);
  const rows = useWindowedRows({
    rowCount,
    rowHeight,
    scrollRef,
    viewport,
    scrollMargin: paddingTop,
  });
  useLoadMoreWhenAtEnd({
    lastRendered: (rows.lastRendered + 1) * columns - 1,
    total: people.length,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
  });

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5">
      <div
        role="list"
        aria-label={t("people.title")}
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          columnGap: gap,
          rowGap: 0,
          paddingTop,
        }}
      >
        {rows.paddingTop > 0 ? (
          <div aria-hidden="true" style={{ gridColumn: "1 / -1", height: rows.paddingTop }} />
        ) : null}
        {rows.indexes.flatMap((row) =>
          people.slice(row * columns, row * columns + columns).map((person, offset) => (
            <div key={person.user_id} style={{ height: rowHeight, paddingBottom: gap }}>
              <PersonCard
                person={person}
                href={hrefFor(person.user_id)}
                position={row * columns + offset + 1}
                total={Math.max(total, people.length)}
                onChat={onChat}
              />
            </div>
          )),
        )}
        {rows.paddingBottom > 0 ? (
          <div aria-hidden="true" style={{ gridColumn: "1 / -1", height: rows.paddingBottom }} />
        ) : null}
      </div>
      {isFetchingNextPage ? (
        <PeopleCardsSkeleton count={columns} columns={columns} />
      ) : null}
      <div aria-hidden="true" style={{ height: LIST_GRID_BOTTOM_CLEARANCE }} />
    </div>
  );
}
