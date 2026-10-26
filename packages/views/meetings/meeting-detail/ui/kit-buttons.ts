/**
 * Class overrides that make the `Button` primitive draw the meeting kit's
 * buttons (kit `.btn*`), so every package passes the same `className`:
 *
 *   <Button variant="outline" size="lg" className={cn(kitButton.base, kitButton.outline)}>
 *
 * `base` goes with size="lg" (36, px 14, gap 8, r10); `sm` with size="default"
 * (32, px 10, r8); `icon` with variant="ghost" size="icon-sm" (28, muted).
 * The primary is variant="brand" (hover darkens on every element).
 */
export const kitButton = {
  base: "gap-2 px-3.5",
  sm: "gap-2 rounded-md",
  /** Kit outline sits on the page in dark mode, where the primitive tints it. */
  outline: "dark:bg-background dark:hover:bg-surface-hover",
  ghost: "dark:hover:bg-surface-hover",
  /** variant="ghost" + this: red ink, soft red on hover (the repo `destructive` is filled at rest). */
  ghostDanger: "text-destructive hover:bg-destructive-soft hover:text-destructive dark:hover:bg-destructive-soft",
  icon: "text-muted-foreground",
  /** Kit [aria-disabled]: muted ink and a plain edge instead of a fade. */
  inactive: "aria-disabled:opacity-100 aria-disabled:text-muted-foreground aria-disabled:border-border",
} as const;
