"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@uniwork/ui/lib/utils"

// No `outline-none` and no focus ring: the global `:focus-visible` outline
// (base.css) is the indicator, as on Button; the ring it replaced measured
// 2.4:1. Pressed is the brandSubtle wash plus brand text and a heavier weight,
// so it no longer reads the same as hover (`bg-muted`); `aria-pressed:` sorts
// after `hover:`, so a hovered pressed item keeps its pressed look.
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-control text-body font-medium whitespace-nowrap transition-all hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-brand-subtle aria-pressed:font-semibold aria-pressed:text-brand-subtle-foreground dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-muted",
        toolbar:
          "border border-transparent bg-surface-hover/60 hover:bg-surface-hover",
      },
      size: {
        default: "h-8 min-w-8 px-2",
        sm: "h-7 min-w-7 rounded-md px-1.5 text-label",
        lg: "h-9 min-w-9 px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
