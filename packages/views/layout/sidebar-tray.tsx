"use client";

import { ChevronsUpDown } from "lucide-react";

export const TRAY_CORE =
  "rounded-xl bg-surface/45 hover:bg-surface/75 data-[popup-open]:bg-surface/75 group-data-[collapsible=icon]:rounded-lg group-data-[collapsible=icon]:bg-transparent";

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
