"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

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
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control border border-transparent bg-clip-padding text-body font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed pointer-coarse:min-h-11 pointer-coarse:min-w-11 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
        // Dense toolbars already provide the context that identifies an action.
        // Use a soft filled surface without a persistent edge so these actions
        // do not compete with data-entry fields; the global focus outline
        // remains the high-contrast keyboard indicator.
        toolbar:
          "border-transparent bg-surface-hover/60 hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-hover aria-expanded:text-foreground",
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
        // The brand as a wash — "there is activity here", the AI entry point,
        // a chip that is ON without claiming the filled state. Reads the
        // measured --brand-subtle pair (5.62 light / 5.82 dark on the wash)
        // instead of an alpha of the brand, so the same button measures the
        // same on a card and on the muted band. Hover deepens the wash one
        // notch through the brand itself; the text stays the brand colour.
        brandSubtle:
          "border-transparent bg-brand-subtle text-brand-subtle-foreground hover:bg-brand/15 hover:text-brand-subtle-foreground active:bg-brand/20 aria-expanded:bg-brand/15 aria-expanded:text-brand-subtle-foreground dark:hover:bg-brand/25 dark:active:bg-brand/30 dark:aria-expanded:bg-brand/25",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        // Solid signal fills for the one action that must read as final
        // (end a meeting, leave a call) or as "go" (admit a guest). They pair
        // the measured `*-solid` fill with `--on-solid`, so callers stop
        // stacking `!bg-…` overrides on top of another variant. The hover
        // deepens through an alpha of the same solid, the convention the
        // other filled variants use.
        destructiveSolid:
          "border-destructive-solid bg-destructive-solid text-on-solid hover:bg-destructive-solid/90 hover:text-on-solid active:bg-destructive-solid/85 aria-expanded:bg-destructive-solid/90 aria-expanded:text-on-solid focus-visible:ring-destructive/30",
        successSolid:
          "border-success-solid bg-success-solid text-on-solid hover:bg-success-solid/90 hover:text-on-solid active:bg-success-solid/85 aria-expanded:bg-success-solid/90 aria-expanded:text-on-solid focus-visible:ring-success/30",
        // A chip on the always-dark meeting stage bar. Reads the meeting-bar
        // slots, which are dark in both themes, so the chip does not flip
        // with the page the way `outline` does. `aria-pressed` and an open
        // popover share the hover wash: the state is also in the icon/label.
        meetingChip:
          "border-meeting-bar-border bg-meeting-bar-chip-bg text-meeting-bar-foreground hover:bg-meeting-bar-chip-hover hover:text-meeting-bar-foreground aria-expanded:bg-meeting-bar-chip-hover aria-expanded:text-meeting-bar-foreground aria-pressed:bg-meeting-bar-chip-hover data-popup-open:bg-meeting-bar-chip-hover",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-sm px-2 text-caption in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-label in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-sm in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-md in-data-[slot=button-group]:rounded-md",
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

// A link that looks like a button. Deliberately not `<Button render={<a/>}>`:
// Base UI's button asserts on the element it lands on, and both answers are
// wrong for a real anchor. Left at `nativeButton` (the default) it errors —
// "expected a native <button>" — and stamps `type="button"`, which on an `<a>`
// is a MIME hint, not a behaviour. Set to `nativeButton={false}` it stops
// erroring but stamps `role="button"` over the anchor, which is what tells a
// screen reader the thing navigates. The styling is all these call sites ever
// wanted, so take `buttonVariants` and leave the anchor an anchor.
function ButtonLink({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: ComponentProps<"a"> & VariantProps<typeof buttonVariants>) {
  // `children` is destructured rather than spread so jsx-a11y can see the
  // anchor has content; through `{...props}` the rule reads it as empty.
  return (
    <a
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </a>
  )
}

export { Button, ButtonLink, buttonVariants }
