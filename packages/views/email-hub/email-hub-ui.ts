import { cn } from "@uniwork/ui/lib/utils";

/**
 * Sidebar folder / label row. The active row keeps its wash under the pointer:
 * a generic `hover:bg-muted` used to repaint the selected folder grey, so the
 * row you had just picked looked unselected until the mouse left it.
 */
export function emailHubNavItemClass(active: boolean) {
  return cn(
    "flex min-h-9 w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-body transition-[background-color,color] duration-(--duration-fast)",
    active
      ? "bg-brand-subtle font-medium text-brand-subtle-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

/** Radius rule for the whole screen: chips are round, controls use `rounded-control`, cards `rounded-lg`. */
export const emailHubFilterChipClass = (active: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-caption font-medium transition-colors duration-(--duration-fast) pointer-coarse:min-h-11",
    active
      ? "border-brand/35 bg-brand-subtle text-brand-subtle-foreground hover:bg-brand/15"
      : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
  );

/** Count badge on a folder row. */
export const emailHubCountBadgeClass =
  "ml-auto min-w-6 rounded-full px-1.5 py-0.5 text-center text-caption font-semibold tabular-nums";
