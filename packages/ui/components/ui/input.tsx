import * as React from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-[var(--uw-radius)] border border-line bg-surface px-2.5 text-sm text-primary placeholder:text-tertiary",
        className,
      )}
      {...props}
    />
  );
}
