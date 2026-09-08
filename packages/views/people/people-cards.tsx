"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "@uniwork/core/types/people";
import { LIST_GRID_BOTTOM_CLEARANCE } from "@uniwork/ui/components/ui/list-grid";
import { PeopleCardsSkeleton } from "./people-skeleton";
import { PersonCard, PERSON_CARD_HEIGHT } from "./person-card";
import {
  useLoadMoreWhenAtEnd,
  useScrollViewport,
  useWindowedRows,
} from "./use-people-virtualizer";

/**
 * The card grid — the view the directory opens on.
 *
 * Column count comes from the measured width of the scroll pane rather than
 * from viewport breakpoints, so the grid is right inside a split pane too. The
 * same measurement gives the windowing its row size, which is why row gap is
 * paid as padding inside each cell: a CSS `row-gap` would sit between rows and
 * put every spacer height off by one gap.
 *
 * The grid carries list semantics by hand. Only a band of cards is in the DOM
 * at any time, so each one states its place and the size of the whole
 * directory; without that a screen reader would report the window as the list.
 */

const CARD_MIN_WIDTH = 232;
const GRID_GAP = 12;
const GRID_PADDING_TOP = 16;
const ROW_HEIGHT = PERSON_CARD_HEIGHT + GRID_GAP;
const MAX_COLUMNS = 4;

/** How many cards fit across `width` pixels, at least one and at most four. */
export function columnsForWidth(width: number): number {
  if (width <= 0) return 1;
  const fits = Math.floor((width + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP));
  return Math.min(MAX_COLUMNS, Math.max(1, fits));
}

export function PeopleCards({
  people,
  hrefFor,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  people: Person[];
  hrefFor: (userId: string) => string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useScrollViewport(scrollRef);
  const columns = columnsForWidth(viewport.size.width);
  const rowCount = Math.ceil(people.length / columns);
  const rows = useWindowedRows({
    rowCount,
    rowHeight: ROW_HEIGHT,
    scrollRef,
    viewport,
    scrollMargin: GRID_PADDING_TOP,
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
          columnGap: GRID_GAP,
          rowGap: 0,
          paddingTop: GRID_PADDING_TOP,
        }}
      >
        {rows.paddingTop > 0 ? (
          <div aria-hidden="true" style={{ gridColumn: "1 / -1", height: rows.paddingTop }} />
        ) : null}
        {rows.indexes.flatMap((row) =>
          people.slice(row * columns, row * columns + columns).map((person, offset) => (
            <div key={person.user_id} style={{ height: ROW_HEIGHT, paddingBottom: GRID_GAP }}>
              <PersonCard
                person={person}
                href={hrefFor(person.user_id)}
                position={row * columns + offset + 1}
                total={people.length}
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
