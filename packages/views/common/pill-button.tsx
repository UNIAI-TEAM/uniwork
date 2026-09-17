"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";

const pillChrome =
  "inline-flex h-8 max-w-56 min-w-0 items-center gap-1 rounded-full border border-border/80 bg-muted/40 px-2.5 text-caption font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

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
    <span className={cn("inline-flex max-w-56 min-w-0 items-center gap-0.5", className)}>
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
