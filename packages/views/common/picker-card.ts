import { cn } from "@uniwork/ui/lib/utils";

/** A choice card with a bold outline when selected (onboarding org/workspace pickers, the email connect methods). */
export const pickerCardClass = (selected: boolean) =>
  cn(
    "w-full rounded-lg border bg-card text-left transition-[color,background-color,border-color,box-shadow]",
    selected
      ? "border-foreground shadow-[inset_0_0_0_1px_var(--foreground)]"
      : "border-border hover:border-input hover:bg-muted/60",
  );
