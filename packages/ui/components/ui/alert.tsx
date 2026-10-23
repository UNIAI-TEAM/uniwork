import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@uniwork/ui/lib/utils"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-body has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive *:[svg]:text-current",
        // The soft tones read their signal's soft pair, opaque, so a notice
        // measures the same on the page and on a card (light / dark):
        // warning 6.06 / 7.89, success 5.51 / 8.16, destructiveSoft
        // 6.25 / 5.58. alert.test.tsx composites each one in both themes.
        // A passing state (busy, try again) is warning; something that
        // cannot be undone or done here is destructiveSoft; good news is
        // success.
        warning:
          "border-warning-soft-foreground/20 bg-warning-soft text-warning-soft-foreground *:data-[slot=alert-description]:text-warning-soft-foreground",
        success:
          "border-success-soft-foreground/20 bg-success-soft text-success-soft-foreground *:data-[slot=alert-description]:text-success-soft-foreground",
        destructiveSoft:
          "border-destructive-soft-foreground/20 bg-destructive-soft text-destructive-soft-foreground *:data-[slot=alert-description]:text-destructive-soft-foreground",
        // A quiet band for a standing fact or a hint, no signal colour:
        // muted-foreground on muted/50 measures 5.67 light, 6.43 dark at the
        // tightest plane (surface-raised).
        muted:
          "border-transparent bg-muted/50 text-muted-foreground *:data-[slot=alert-description]:text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/**
 * `role="alert"` by default, which interrupts whatever is being read — use it
 * for an error the user must hear now. A notice that reports a passing state
 * passes `role="status"`; one that is part of the content (a hint, a fact
 * about the step) passes `role="note"`. A caller's role wins over the default.
 */
function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-heading font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-body text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
