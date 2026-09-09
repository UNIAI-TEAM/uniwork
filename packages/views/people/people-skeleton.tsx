"use client";

import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { PERSON_CARD_HEIGHT } from "./person-card";

/**
 * What the directory shows while it is loading, in both views.
 *
 * A spinner says only "wait"; these say what is coming and hold the layout
 * still, so the first page of real people lands in place instead of pushing
 * the page around. The shapes match the real card and row silhouettes, which
 * is what keeps them honest — they are not decorative bars.
 */

const CARD_GAP = 12;

function CardShape() {
  return (
    <div style={{ height: PERSON_CARD_HEIGHT + CARD_GAP, paddingBottom: CARD_GAP }}>
      <div className="flex h-full flex-col rounded-md border border-border bg-card">
        <div className="flex items-center gap-3 p-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        <div className="mt-auto flex items-center gap-2 border-t border-border px-3 py-2">
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-3 w-2/5" />
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
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="hidden h-3 w-32 @2xl:block" />
          <Skeleton className="hidden h-3 w-40 @2xl:block" />
        </div>
      ))}
    </div>
  );
}

/**
 * The detail page while it loads. It mirrors the real page's shape — hero,
 * then the fact card beside the narrower side column — so the profile lands in
 * place rather than pushing the page around once it arrives.
 */
export function PersonDetailSkeleton() {
  return (
    <div aria-hidden="true" className="min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <Skeleton className="size-16 shrink-0 rounded-full sm:size-20" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-full max-w-prose" />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <PanelShape rows={4} />
          <PanelShape rows={2} />
        </div>
      </div>
    </div>
  );
}

function PanelShape({ rows }: { rows: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-surface-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Skeleton className="size-7 shrink-0 rounded-lg" />
        <Skeleton className="h-3.5 w-24" />
      </div>
      <div className="divide-y divide-border px-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
