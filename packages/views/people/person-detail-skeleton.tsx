"use client";

import { Skeleton } from "@uniwork/ui/components/ui/skeleton";

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
