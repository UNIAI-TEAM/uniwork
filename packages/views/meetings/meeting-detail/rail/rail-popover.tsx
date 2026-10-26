"use client";
import { useRef, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTitle } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * A rail row's popover state, anchored on the row's wrapper (the `RailProp`
 * atom draws its own button). A press on the row itself is not an outside
 * press: the row's click toggles, so a second click closes it.
 */
export function useRailPopover() {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return { anchor, open, setOpen, toggle: () => setOpen((v) => !v) };
}

export function RailPopover({
  state,
  title,
  children,
  footer,
  className,
}: {
  state: ReturnType<typeof useRailPopover>;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const { anchor, open, setOpen } = state;
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        const target = details.event?.target;
        if (!next && details.reason === "outside-press" && target instanceof Node && anchor.current?.contains(target)) return;
        setOpen(next);
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="bottom"
        align="end"
        // Back to the row's own button.
        finalFocus={() => anchor.current?.querySelector("button") ?? true}
        className={cn("w-80 max-w-[calc(100vw-32px)] gap-0 bg-popover p-0 ring-border", className)}
      >
        <PopoverTitle className="px-4 pt-3.5 pb-1 text-label font-semibold">{title}</PopoverTitle>
        <div className="max-h-[min(60vh,28rem)] overflow-auto px-4 pt-1 pb-3">{children}</div>
        {footer ? <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">{footer}</div> : null}
      </PopoverContent>
    </Popover>
  );
}

