import { cn } from "@uniwork/ui/lib/utils";

/** A choice card with a bold outline when selected (onboarding org/workspace pickers, the email connect methods). */
export const pickerCardClass = (selected: boolean) =>
  cn(
    // The same 1px press every Button gives, on a live button only: the
    // collapsible create card is a <div> around a form, and `:active` would
    // nudge the whole card on every click into its fields. Still under
    // reduced motion.
    "w-full rounded-lg border bg-card text-left transition-[color,background-color,border-color,box-shadow,transform] duration-150 motion-safe:enabled:not-aria-disabled:active:translate-y-px",
    selected
      ? "border-foreground shadow-[inset_0_0_0_1px_var(--foreground)]"
      : "border-border hover:border-input hover:bg-muted/60",
  );
