"use client";

import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";

/**
 * The loading wrapper every meeting section shares: announced once to screen
 * readers, busy for assistive tech, and shaped by the caller like its rows.
 */
export function MeetingSectionLoading({
  className,
  label,
  children,
}: {
  className?: string;
  /** What is loading, when "Loading…" alone would not say. */
  label?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy className={className}>
      <span className="sr-only">{label ?? t("common.loading")}</span>
      {children}
    </div>
  );
}

const ROW_WIDTHS = ["w-32", "w-24", "w-28"];

/** Avatar + two lines per row — notes, activity, people and member lists. */
export function MeetingRowsSkeleton({
  rows = 3,
  className,
  rowClassName,
}: {
  rows?: number;
  className?: string;
  rowClassName?: string;
}) {
  return (
    <MeetingSectionLoading className={className}>
      {ROW_WIDTHS.slice(0, rows).map((w) => (
        <div key={w} className={cn("flex items-center gap-3 px-4 py-2.5", rowClassName)}>
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", w)} />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </MeetingSectionLoading>
  );
}

/** Lines of prose — a summary or transcript that is still on its way. */
export function MeetingTextSkeleton({ className }: { className?: string }) {
  return (
    <MeetingSectionLoading className={cn("space-y-2", className)}>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-2/3" />
    </MeetingSectionLoading>
  );
}

/** A section whose query failed: say so, and offer to try again. */
export function MeetingSectionError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Notice
      tone="destructive"
      icon={AlertCircle}
      layout="inline"
      className={className}
      action={
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      }
    >
      {message}
    </Notice>
  );
}
