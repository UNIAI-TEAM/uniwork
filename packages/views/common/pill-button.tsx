"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * Pill chrome for create-task / property toolbars. Hard width cap so
 * long project/assignee/label text wraps siblings instead of owning the row.
 * On a coarse pointer the target inside the 1px border is 44px, like every
 * registry control: 46px outside, so a clearable pill's inner buttons get 44.
 */
const PILL_CHROME =
  "inline-flex min-w-0 max-w-56 items-center overflow-hidden rounded-full border border-border/80 text-caption font-medium text-muted-foreground transition-colors pointer-coarse:min-h-[2.875rem]";

export function PillButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        PILL_CHROME,
        "cursor-pointer gap-1.5 px-2.5 py-1 hover:bg-accent/60 hover:text-foreground",
        "data-popup-open:bg-accent data-popup-open:text-accent-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Pill with a trailing clear ×. Same chrome as PillButton; the × is a sibling
 * button (never nested). Forwarded props land on the inner trigger so Popover
 * anchors correctly.
 */
export function ClearablePillButton({
  children,
  className,
  onClear,
  clearLabel,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  onClear?: () => void;
  clearLabel?: string;
  /** Filled by PopoverTrigger when used as `triggerRender`. */
  children?: ReactNode;
}) {
  const clearable = Boolean(onClear) && !disabled;
  return (
    <span
      className={cn(
        PILL_CHROME,
        !disabled && "hover:bg-accent/60 hover:text-foreground",
        "has-[[data-popup-open]]:bg-accent has-[[data-popup-open]]:text-accent-foreground",
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled}
        className={cn(
          // self-stretch: on a coarse pointer the whole 44px pill is the target.
          "flex min-w-0 cursor-pointer items-center gap-1.5 self-stretch overflow-hidden py-1 pl-2.5",
          clearable ? "pr-1" : "pr-2.5",
          "disabled:cursor-not-allowed",
        )}
        {...props}
      >
        {children}
      </button>
      {clearable ? (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={(event) => {
            event.stopPropagation();
            onClear?.();
          }}
          className="flex shrink-0 cursor-pointer items-center self-stretch py-1 pr-2 pl-0.5 text-muted-foreground hover:text-foreground pointer-coarse:min-w-11 pointer-coarse:justify-center"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
