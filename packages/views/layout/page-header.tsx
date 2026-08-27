"use client";

import { SidebarTrigger, useSidebarSafe } from "@uniwork/ui/components/ui/sidebar";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The left edge every page shares: the header, the toolbar under it, and any
 * body row that has to line up with them.
 */
export const PAGE_GUTTER = "px-4";

/**
 * The filter/actions row directly under a `PageHeader`: same height and
 * gutter so the two read as one chrome block.
 */
export const PAGE_TOOLBAR = cn(
  "flex h-12 shrink-0 items-center justify-between gap-2",
  PAGE_GUTTER,
);

/**
 * The way back to the nav wherever it is not a permanent column (a sheet
 * below the compact breakpoint). Every surface below `xl` needs one of these;
 * PageHeader supplies it, and it is exported for pages that build their own
 * chrome. Renders nothing outside a SidebarProvider so such a page can still
 * stand alone.
 */
export function CollapsedNavTrigger() {
  const sidebar = useSidebarSafe();
  if (!sidebar || sidebar.hasExternalTrigger) return null;
  return <SidebarTrigger className="xl:hidden" />;
}

interface PageHeaderProps {
  children: React.ReactNode;
  /**
   * Replaces the mobile sidebar trigger at the far left — for a surface a
   * phone reaches by drilling in, where "go back" is the affordance that
   * matters and the nav is one step behind it.
   */
  leading?: React.ReactNode;
  className?: string;
}

/** 48px header row shared by every workspace screen. */
export function PageHeader({ children, leading, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-border",
        className,
        PAGE_GUTTER,
      )}
    >
      {leading ?? <CollapsedNavTrigger />}
      {children}
    </header>
  );
}
