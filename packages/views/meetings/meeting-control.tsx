"use client";

import { createContext, useContext, useState, type ComponentProps, type MouseEventHandler, type ReactNode } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { createTooltipHandle, Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";

/** Shared presentation only; connecting devices belongs to MeetingControlBar. */
export const MEETING_CHIP = "size-11 shrink-0 rounded-xl";

type BarTipHandle = ReturnType<typeof createTooltipHandle<unknown>>;
const BarTipCtx = createContext<BarTipHandle | null>(null);
// The tip slides to the next button instead of closing and reopening (UNI-2285 E).
const GLIDE =
  "transition-[top,left,right,bottom,transform] duration-fast ease-out-quart data-instant:transition-none motion-reduce:transition-none";

/**
 * One tooltip for the whole control bar: the first waits for the provider's
 * delay, then moving to the next button shows it at once and glides it there.
 */
export function ControlBarTooltips({ children }: { children: ReactNode }) {
  const [handle] = useState(() => createTooltipHandle<unknown>());
  return (
    <BarTipCtx.Provider value={handle}>
      {children}
      <Tooltip handle={handle}>
        {({ payload }) => (
          <TooltipContent side="top" className="dark" positionerClassName={GLIDE}>
            {typeof payload === "string" ? payload : null}
          </TooltipContent>
        )}
      </Tooltip>
    </BarTipCtx.Provider>
  );
}

/** A control's tooltip: the bar's shared one inside ControlBarTooltips, its own anywhere else. */
export function BarTooltipTrigger({ label, ...props }: ComponentProps<typeof TooltipTrigger> & { label: string }) {
  const handle = useContext(BarTipCtx);
  if (handle) return <TooltipTrigger handle={handle} payload={label} {...props} />;
  return (
    <Tooltip>
      <TooltipTrigger {...props} />
      <TooltipContent side="top" className="dark">{label}</TooltipContent>
    </Tooltip>
  );
}

// `busy`: a switch is under way. aria-disabled, not disabled: the button keeps focus (and the
// Button primitive drops the click), so a keyboard user is not thrown back to <body>.
export function IconControl({ label, tooltip, pressed, tone, onClick, busy, className, children }: {
  label: string; tooltip?: string; pressed?: boolean; tone?: "off" | "active";
  onClick?: MouseEventHandler<HTMLButtonElement>; busy?: boolean; className?: string; children: ReactNode;
}) {
  return <BarTooltipTrigger label={tooltip ?? label} render={<Button type="button" size="icon-lg" variant={tone === "off" ? "destructiveSolid" : tone === "active" ? "brand" : "meetingChip"} aria-label={label} aria-pressed={pressed} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={onClick} className={cn(MEETING_CHIP, className)} />}>{children}</BarTooltipTrigger>;
}

export function MenuControl({ caption, pressed, onClick, busy, children }: {
  caption: string; pressed?: boolean; onClick?: MouseEventHandler<HTMLButtonElement>;
  busy?: boolean; children: ReactNode;
}) {
  return <Button type="button" variant={pressed ? "secondary" : "ghost"} aria-pressed={pressed} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={onClick} className="h-11 w-full justify-start gap-3">{children}{caption}</Button>;
}
