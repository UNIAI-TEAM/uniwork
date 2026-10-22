import { Skeleton } from "@uniwork/ui/components/ui/skeleton";

/** Stands in for the page body while the lazy editor chunk loads. */
export function PageBodySkeleton() {
  return (
    <div className="min-h-64 space-y-3" aria-busy>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
