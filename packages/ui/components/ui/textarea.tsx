import * as React from "react"

import { cn } from "@uniwork/ui/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      // text-title-sm is here for its 16px (iOS focus zoom), not its role:
      // font-sans and tracking-normal keep the heading family and its
      // negative tracking out of typed text, where they ate the word spaces.
      // The focus indicator is a solid --ring ring, not the global outline:
      // composites (InputGroup, the slug pill, chat and Ask UNI composers)
      // replace or silence it through ring utilities, and an outline here
      // would draw a second ring inside theirs. ring-ring/30 measured 1.63:1.
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-control border border-input bg-transparent px-2.5 py-2 font-sans text-title-sm tracking-normal transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring aria-invalid:focus-visible:ring-destructive dark:aria-invalid:focus-visible:ring-destructive disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-body dark:bg-surface-hover/60 dark:disabled:bg-surface-hover/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
