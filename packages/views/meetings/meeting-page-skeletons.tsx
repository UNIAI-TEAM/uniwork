"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { MeetingInviteShell } from "./meeting-invite-shell";

/**
 * Route-level loading states for the meeting pages. Each one is shaped like
 * the screen it turns into so nothing jumps when the real view arrives.
 * No next/* imports: the web pages pass these as Suspense fallbacks.
 */

function LoadingRegion({ className, children }: { className?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{t("common.loading")}</span>
      <div aria-hidden className="contents">
        {children}
      </div>
    </div>
  );
}

/** Meeting detail: the redesigned page's real geometry (LoadingError crop 1). */
export { DetailSkeleton as MeetingDetailPageSkeleton } from "./meeting-detail/detail-skeleton";

/** Room and prejoin routes: the full-screen stage with video tiles. */
export function MeetingStagePageSkeleton() {
  return (
    <LoadingRegion className="fixed inset-0 z-40 flex min-h-0 min-w-0 flex-col items-center justify-center gap-4 overflow-hidden bg-background p-6">
      <div className="grid w-full max-w-md grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="aspect-video rounded-2xl bg-meeting-stage" />
        ))}
      </div>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-32" />
    </LoadingRegion>
  );
}

/** Public invite: camera frame on one side, the join form on the other. */
export function MeetingInvitePageSkeleton() {
  return (
    <MeetingInviteShell>
      <LoadingRegion className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-12">
        <div className="min-w-0">
          <Skeleton className="aspect-video min-h-52 w-full rounded-2xl bg-meeting-stage sm:min-h-60" />
          <Skeleton className="mx-auto mt-3 h-3 w-64 max-w-full" />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-col gap-5 lg:mx-0 lg:max-w-none">
          <div className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-4/5" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-7 w-56 rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-11 w-full" />
          </div>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="mx-auto h-4 w-44" />
        </div>
      </LoadingRegion>
    </MeetingInviteShell>
  );
}
