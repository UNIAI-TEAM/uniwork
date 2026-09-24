import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@uniwork/ui/lib/utils"

function Input({
  className,
  type,
  variant = "default",
  ...props
}: React.ComponentProps<"input"> & { variant?: "default" | "subtle" }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      // text-title-sm is here for its 16px (iOS focus zoom), not its role:
      // font-sans and tracking-normal keep the heading family and its
      // negative tracking out of typed text, where they ate the word spaces.
      className={cn(
        "h-8 w-full min-w-0 pointer-coarse:min-h-11 rounded-control border px-2.5 py-1 font-sans text-title-sm tracking-normal transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-body dark:disabled:bg-surface-hover/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        variant === "default"
          ? "border-input bg-transparent dark:bg-surface-hover/60"
          : "border-transparent bg-surface-hover/60 hover:bg-surface-hover",
        className
      )}
      {...props}
    />
  )
}

export { Input }
