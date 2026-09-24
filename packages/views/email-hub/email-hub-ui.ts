import { cn } from "@uniwork/ui/lib/utils";

/** Sidebar folder / nav row */
export function emailHubNavItemClass(active: boolean) {
  return cn(
    "flex min-h-11 w-full items-center gap-2.5 rounded-control px-3 py-2 text-body text-muted-foreground transition-[background-color,color]",
    "hover:bg-muted/45 hover:text-foreground",
    active && "bg-brand-subtle font-medium text-brand-subtle-foreground",
  );
}

/** Connected mailbox picker row */
export function emailHubAccountRowClass(active: boolean) {
  return cn(
    "min-w-0 flex-1 truncate rounded-control border border-transparent px-3 py-2.5 text-left text-caption transition-[background-color,border-color,color]",
    "hover:border-border/70 hover:bg-muted/35",
    active && "border-brand/30 bg-brand-subtle font-medium text-brand-subtle-foreground",
  );
}

export const emailHubIconActionClass =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50";

export const emailHubToolbarShellClass =
  "flex flex-wrap items-center gap-1 rounded-control border border-border/50 bg-muted/25 p-1";

export const emailHubFilterChipClass = (active: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-caption font-medium shadow-none transition-colors",
    active
      ? "border-brand/35 bg-brand-subtle text-brand-subtle-foreground hover:bg-brand/15"
      : "border-border/70 bg-background/80 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
  );

export const emailHubComposeButtonClass = "h-10 w-full justify-start gap-2 rounded-control shadow-none";

export const emailHubSecondaryNavButtonClass =
  "h-9 w-full justify-start gap-2 rounded-control border-dashed border-border/80 bg-transparent text-muted-foreground shadow-none hover:bg-muted/30";
