"use client";

import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

/** Card-style row for the meetings list (desktop and mobile). */
export function MeetingCardRow({
  className,
  children,
  onClick,
  as: Tag = "div",
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  as?: "div" | "button";
}) {
  const interactive = Tag === "button" || Boolean(onClick);
  return (
    <Tag
      type={Tag === "button" ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border border-border bg-surface px-3 py-3 text-left transition-colors sm:grid-cols-[5rem_minmax(0,1fr)_auto_auto] sm:gap-x-4 sm:px-4",
        interactive && "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function MeetingCardRowTime({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-caption tabular-nums text-muted-foreground", className)}>
      {children}
    </div>
  );
}

export function MeetingCardRowMain({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0", className)}>{children}</div>;
}

export function MeetingCardRowActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center justify-end gap-2 sm:col-start-4", className)}>
      {children}
    </div>
  );
}
