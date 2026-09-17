"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";

const pillChrome =
  "inline-flex max-w-56 min-w-0 items-center gap-1.5 overflow-hidden rounded-full border border-border/80 bg-transparent px-2.5 py-1 text-caption font-medium text-muted-foreground shadow-none transition-colors hover:bg-accent/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

export function PillButton({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn(pillChrome, className)} {...props} />;
}

type ClearablePillButtonProps = {
  onClear: () => void;
  clearLabel: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
};

export function ClearablePillButton({
  onClear,
  clearLabel,
  children,
  className,
  disabled,
}: ClearablePillButtonProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-56 min-w-0 items-center overflow-hidden rounded-full border border-border/80 bg-transparent text-caption text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
        "[&_[data-slot=select-trigger]]:h-7 [&_[data-slot=select-trigger]]:w-fit [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:rounded-full [&_[data-slot=select-trigger]]:border-0 [&_[data-slot=select-trigger]]:bg-transparent [&_[data-slot=select-trigger]]:shadow-none [&_[data-slot=select-trigger]]:hover:bg-transparent",
        className,
      )}
    >
      {children}
      <button
        type="button"
        aria-label={clearLabel}
        aria-disabled={disabled || undefined}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-border hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 pointer-coarse:size-11"
        onClick={(event) => {
          event.stopPropagation();
          if (disabled) return;
          onClear();
        }}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}
