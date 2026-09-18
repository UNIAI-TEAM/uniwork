"use client";

import { ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Double-bezel tray for the sidebar's two identity blocks (workspace and
 * account): a translucent shell with a hairline, and the control seated in it
 * on a concentric radius. In the icon rail both collapse back to a bare 32px
 * control, since a tray around a single glyph is only noise.
 */
export function Tray({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface/55 p-1 ring-1 ring-border/60 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:ring-0">
      {children}
    </div>
  );
}

export const TRAY_CORE =
  "rounded-[calc(var(--radius-2xl)-0.25rem)] bg-surface shadow-surface hover:bg-surface data-[popup-open]:bg-surface group-data-[collapsible=icon]:rounded-lg group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:shadow-none";

/** The trailing chevron, seated in its own disc rather than floating naked. */
export function ChevronDisc() {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform duration-(--duration-standard) ease-out-quart group-hover/menu-button:scale-105 group-data-[collapsible=icon]:hidden motion-reduce:transition-none"
    >
      <ChevronsUpDown className="size-3.5!" strokeWidth={1.75} />
    </span>
  );
}
