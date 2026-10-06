"use client";

import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { PageHeader } from "./page-header";

/**
 * One ancestor crumb. Normally a link to the segment's container — the
 * breadcrumb is a containment chain, so a segment with a known destination
 * navigates there. `href` may be omitted when the destination does not exist
 * yet (for example an owner surface another slice still owes): the crumb then
 * renders as a plain label instead of pointing at a guessed URL.
 */
export interface BreadcrumbSegment {
  href?: string;
  label: ReactNode;
  /** Overrides the default `shrink-0`, e.g. for a truncating long title. */
  className?: string;
}

interface BreadcrumbHeaderProps {
  segments: BreadcrumbSegment[];
  /** The current page — a non-clickable leaf. */
  leaf: ReactNode;
  actions?: ReactNode;
  /** Additional classes for the action wrapper at a specific host breakpoint. */
  actionsClassName?: string;
  leading?: ReactNode;
  className?: string;
}

/** Detail-page header: `ancestor › ancestor › leaf  [actions]`. */
export function BreadcrumbHeader({ segments, leaf, actions, actionsClassName, leading, className }: BreadcrumbHeaderProps) {
  return (
    <PageHeader leading={leading} className={cn("bg-background text-body", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {segments.map((segment, index) => (
          <Fragment key={segment.href ?? `crumb-${index}`}>
            {segment.href ? (
              <AppLink
                href={segment.href}
                className={cn(
                  "text-muted-foreground transition-colors hover:text-foreground",
                  segment.className ?? "shrink-0",
                )}
              >
                {segment.label}
              </AppLink>
            ) : (
              <span className={cn("text-muted-foreground", segment.className ?? "shrink-0")}>
                {segment.label}
              </span>
            )}
            <ChevronRight aria-hidden className="size-3 shrink-0 text-faint-foreground" />
          </Fragment>
        ))}
        <span className="min-w-0 truncate">{leaf}</span>
      </div>
      {actions ? (
        // Narrow screens scroll the actions sideways only: overflow-x-auto alone
        // turns overflow-y to auto too, and a pressed button's 1px shift would
        // then flash a scrollbar. From sm up the row is unbounded, so nothing clips.
        <div className={cn("flex min-w-0 max-w-[58%] shrink-0 items-center justify-end gap-1 overflow-x-auto overflow-y-hidden sm:max-w-none sm:overflow-visible", actionsClassName)}>
          {actions}
        </div>
      ) : null}
    </PageHeader>
  );
}
