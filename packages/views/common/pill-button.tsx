"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * Multica pill chrome for create-task / property toolbars. Hard width cap so
 * long project/assignee/label text wraps siblings instead of owning the row.
 */
const PILL_CHROME =
  "inline-flex min-w-0 max-w-56 items-center overflow-hidden rounded-full border border-border/80 text-caption font-medium text-muted-foreground transition-colors";

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
          "flex min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden py-1 pl-2.5",
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
          className="flex shrink-0 cursor-pointer items-center py-1 pr-2 pl-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
