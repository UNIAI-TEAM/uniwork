"use client";

import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { PageHeader } from "./page-header";

/**
 * One ancestor crumb. Always a link to the segment's container — the
 * breadcrumb is a containment chain, so every segment navigates somewhere.
 * Non-navigable chrome (skeletons, unknown states) does not belong here.
 */
export interface BreadcrumbSegment {
  href: string;
  label: ReactNode;
  /** Overrides the default `shrink-0`, e.g. for a truncating long title. */
  className?: string;
}

interface BreadcrumbHeaderProps {
  segments: BreadcrumbSegment[];
  /** The current page — a non-clickable leaf. */
  leaf: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  className?: string;
}

/** Detail-page header: `ancestor › ancestor › leaf  [actions]`. */
export function BreadcrumbHeader({ segments, leaf, actions, leading, className }: BreadcrumbHeaderProps) {
  return (
    <PageHeader leading={leading} className={cn("bg-background text-body", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {segments.map((segment) => (
          <Fragment key={segment.href}>
            <AppLink
              href={segment.href}
              className={cn(
                "text-muted-foreground transition-colors hover:text-foreground",
                segment.className ?? "shrink-0",
              )}
            >
              {segment.label}
            </AppLink>
            <ChevronRight aria-hidden className="size-3 shrink-0 text-faint-foreground" />
          </Fragment>
        ))}
        {leaf}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </PageHeader>
  );
}
