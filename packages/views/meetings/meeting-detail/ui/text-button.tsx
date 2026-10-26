"use client";
import type { ComponentProps, MouseEvent } from "react";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The kit's `.text-btn`: caption 500 in link ink, underline on hover, 44 tall
 * on a coarse pointer. `aria-disabled` keeps it focusable, mutes it and blocks
 * the click (the Button primitive's contract).
 */
export function TextButton({ className, onClick, type = "button", ...props }: ComponentProps<"button">) {
  const inactive = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  return (
    <button
      type={type}
      {...props}
      onClick={(event: MouseEvent<HTMLButtonElement>) => (inactive ? event.preventDefault() : onClick?.(event))}
      className={cn(
        "inline-flex items-center gap-1 rounded-xs py-1 text-caption font-medium text-primary underline-offset-2 hover:underline active:opacity-80 pointer-coarse:min-h-11 aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground aria-disabled:no-underline aria-disabled:active:opacity-100 [&_svg]:size-3",
        className,
      )}
    />
  );
}
