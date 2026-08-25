"use client";

import { SidebarTrigger, useSidebarSafe } from "@uniwork/ui/components/ui/sidebar";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The way back to the nav wherever it is not a permanent column (a sheet
 * below the compact breakpoint). Every surface below `xl` needs one of these;
 * PageHeader supplies it, and it is exported for pages that build their own
 * chrome. Renders nothing outside a SidebarProvider so such a page can still
 * stand alone.
 */
export function CollapsedNavTrigger() {
  const sidebar = useSidebarSafe();
  if (!sidebar) return null;
  return <SidebarTrigger className="mr-2 xl:hidden" />;
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
    <header className={cn("flex h-12 shrink-0 items-center border-b border-border px-4", className)}>
      {leading ?? <CollapsedNavTrigger />}
      {children}
    </header>
  );
}
