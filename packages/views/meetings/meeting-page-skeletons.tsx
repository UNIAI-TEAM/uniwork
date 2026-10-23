"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
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

function CardBlock({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5", className)}>
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Meeting detail: breadcrumb bar, hero block, main column + aside. */
export function MeetingDetailPageSkeleton() {
  return (
    <LoadingRegion className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-8 w-3/5" />
            <div className="flex flex-wrap gap-4">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-36" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex min-w-0 flex-col gap-6">
              <CardBlock lines={4} />
              <CardBlock lines={3} />
            </div>
            <CardBlock lines={5} />
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}

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
