import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";

/** Varied line lengths, spelled out so Tailwind sees them. */
const WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-3/5"] as const;
const width = (i: number) => WIDTHS[i % WIDTHS.length];

/**
 * Loading rows drawn in the shape of the rows they stand for, so the section
 * does not change shape when the data lands.
 */
export function HomeTaskRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
          <Skeleton className="size-4 rounded-sm" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-4", width(i))} />
            <div className="flex gap-2">
              <Skeleton className="h-3.5 w-12" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function HomeMeetingRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-2">
          <div className="flex w-11 flex-col items-end gap-1">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-3 w-8" />
          </div>
          <Skeleton className="w-0.5 self-stretch" />
          <Skeleton className={cn("h-4", width(i + 1))} />
        </div>
      ))}
    </div>
  );
}

export function HomeInboxRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden className="p-1.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 px-2.5 py-2.5">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-4", width(i + 2))} />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
