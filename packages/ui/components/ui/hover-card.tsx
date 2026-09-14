"use client"

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"

import { cn } from "@uniwork/ui/lib/utils"
import { UI_FLOATING_TRANSITION_CLASS } from "@uniwork/ui/lib/motion"

function HoverCard({ ...props }: PreviewCardPrimitive.Root.Props) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({ ...props }: PreviewCardPrimitive.Trigger.Props) {
  return (
    <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  )
}

function HoverCardContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 4,
  onClick,
  onContextMenu,
  onAuxClick,
  onDoubleClick,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  // Stop interaction events from bubbling out of the popup. Base UI portals
  // the popup to <body> so the DOM is detached, but React's synthetic event
  // system still bubbles through the React component tree — without this,
  // events on the popup would also fire on any ancestor of the trigger
  // (e.g. a clickable issue list row, a wrapping <a>).
  //
  // We stop the safe set: click / contextmenu / auxclick / dblclick.
  // We deliberately do NOT stop pointerdown / mousedown — Base UI's
  // outside-click dismiss listens to pointerdown on document and uses an
  // "inside React tree" check to decide whether to close. Stopping
  // pointerdown inside the popup would make the dismiss handler wrongly
  // think the click happened outside, requiring two clicks to close
  // (mirrors radix-ui/primitives#2782).
  const stop = <E extends React.SyntheticEvent>(forwarded?: (e: E) => void) =>
    (e: E) => {
      e.stopPropagation()
      forwarded?.(e)
    }
  return (
    <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          onClick={stop(onClick)}
          onContextMenu={stop(onContextMenu)}
          onAuxClick={stop(onAuxClick)}
          onDoubleClick={stop(onDoubleClick)}
          className={cn(
            "z-50 w-64 rounded-lg bg-popover p-2.5 text-body text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden",
            UI_FLOATING_TRANSITION_CLASS,
            className
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
