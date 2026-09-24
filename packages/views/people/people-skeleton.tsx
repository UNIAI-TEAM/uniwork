"use client";

import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CARD_GAP_REM, PERSON_CARD_HEIGHT_REM } from "./person-card";

/**
 * What the directory shows while it is loading, in both views.
 *
 * A spinner says only "wait"; these say what is coming and hold the layout
 * still, so the first page of real people lands in place instead of pushing
 * the page around. The shapes match the real card and row silhouettes, which
 * is what keeps them honest — they are not decorative bars.
 */

const CARD_GAP = `${CARD_GAP_REM}rem`;

function CardShape() {
  return (
    <div style={{ height: `${PERSON_CARD_HEIGHT_REM + CARD_GAP_REM}rem`, paddingBottom: CARD_GAP }}>
      <div className="flex h-full flex-col rounded-xl border border-surface-border bg-surface">
        <div className="flex flex-1 items-start gap-3 px-3.5 pt-3.5">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="flex h-11 items-center gap-2 px-3.5">
          <Skeleton className="size-2 rounded-full" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}

/**
 * A grid of card placeholders. `columns` is passed by the live grid, which has
 * measured its pane and must not be followed by a band of a different width;
 * the first load has measured nothing yet and falls back to breakpoints.
 */
export function PeopleCardsSkeleton({
  count,
  columns,
  className,
}: {
  count: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={
        columns
          ? `grid ${className ?? ""}`
          : `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${className ?? ""}`
      }
      style={{
        columnGap: CARD_GAP,
        rowGap: 0,
        ...(columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : {}),
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <CardShape key={i} />
      ))}
    </div>
  );
}

/** Row placeholders, shaped like the table's rows. */
export function PeopleRowsSkeleton({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={`@container space-y-1 ${className ?? ""}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-3">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <Skeleton className="h-3.5 w-[min(12rem,38%)]" />
          <Skeleton className="h-3 w-[min(8rem,28%)]" />
          <Skeleton className="hidden h-3 w-24 @2xl:block" />
          <Skeleton className="hidden h-3 w-40 @2xl:block" />
        </div>
      ))}
    </div>
  );
}
