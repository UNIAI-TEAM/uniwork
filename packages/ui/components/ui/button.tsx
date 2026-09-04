"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@uniwork/ui/lib/utils"

// Deliberately without `outline-none`: base.css defines the app-wide
// `:focus-visible` outline inside `@layer base` precisely so a utility can
// override it, and the registry component's unconditional `outline-none` did
// exactly that — it removed the only focus indicator these buttons had. Its
// replacement ring never composed into `box-shadow` here, so the buttons ended
// up with no indicator at all; e2e/onboarding-focus.spec.ts reads that off the
// rendered page. One global outline is also what keeps the "exactly one focus
// ring, not two nested" contract in the same spec.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-body font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed pointer-coarse:min-h-11 pointer-coarse:min-w-11 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        // `border-input` in both modes: the panel hairline (`--border`) sits
        // at ~1.2:1 on the light page, which left outline buttons reading as
        // bare text. Inputs draw their edge with the same token, so a button
        // and a field now share one boundary weight. button.outline.test.tsx
        // pins the token and its 3:1 floor.
        outline:
          "border-input bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-input/30 dark:hover:bg-input/50",
        // Brand-filled state for a control that is currently ON (an active
        // filter, a selected toggle). Self-contained on purpose: passing
        // brand classes through `className` on top of `outline` does NOT
        // work — `outline` ships `dark:bg-input/30`, `hover:bg-muted` and
        // `aria-expanded:bg-muted`, and those win the cascade (the `dark:`
        // ones by specificity, since `dark` compiles to `&:is(.dark *)`),
        // repainting the chip neutral. That is what silently killed the
        // brand colour in dark mode — see MUL-4884.
        //
        // `brand` needs no `dark:` of its own: the --brand token already
        // flips per theme, so one set of rules is correct in both.
        // aria-expanded is pinned to the hover value so opening a popover
        // reads as hover rather than as a colour change.
        brand:
          "border-brand bg-brand text-brand-foreground hover:bg-brand/90 hover:text-brand-foreground active:bg-brand/85 aria-expanded:bg-brand/90 aria-expanded:text-brand-foreground",
        // Brand tint for "there is activity here" — present, but not
        // claiming the loud filled state. Light and dark take their own
        // opacity notches: the same alpha does not read equally against a
        // white and a near-black surface, so dark runs one notch hotter.
        brandSubtle:
          "border-brand/28 bg-brand/7 text-foreground hover:bg-brand/12 hover:text-foreground active:bg-brand/16 aria-expanded:bg-brand/12 aria-expanded:text-foreground dark:border-brand/45 dark:bg-brand/12 dark:hover:bg-brand/18 dark:active:bg-brand/24 dark:aria-expanded:bg-brand/18",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-caption in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-label in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  onClick,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  // `aria-disabled` rather than `disabled` wherever the button must stay in the
  // tab order: `disabled` removes it, so a keyboard user can never reach it to
  // hear why it cannot be pressed. The action is blocked here rather than with
  // `pointer-events-none`, which also suppresses the not-allowed cursor and does
  // not stop the Enter key. Not part of the upstream registry component — added
  // for the onboarding flow, where every step CTA uses it.
  const inactive =
    props["aria-disabled"] === true || props["aria-disabled"] === "true"
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      onClick={inactive ? (e) => e.preventDefault() : onClick}
      {...props}
    />
  )
}

export { Button, buttonVariants }
