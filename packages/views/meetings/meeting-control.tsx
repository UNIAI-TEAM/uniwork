"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";

/** Shared presentation only; connecting devices belongs to MeetingControlBar. */
export const MEETING_CHIP = "size-11 shrink-0 rounded-xl";

// `busy`: a switch is under way. aria-disabled, not disabled: the button keeps focus (and the
// Button primitive drops the click), so a keyboard user is not thrown back to <body>.
export function IconControl({ label, tooltip, pressed, tone, onClick, busy, className, children }: {
  label: string; tooltip?: string; pressed?: boolean; tone?: "off" | "active";
  onClick?: MouseEventHandler<HTMLButtonElement>; busy?: boolean; className?: string; children: ReactNode;
}) {
  return <Tooltip>
    <TooltipTrigger render={<Button type="button" size="icon-lg" variant={tone === "off" ? "destructiveSolid" : tone === "active" ? "brand" : "meetingChip"} aria-label={label} aria-pressed={pressed} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={onClick} className={cn(MEETING_CHIP, className)} />}>{children}</TooltipTrigger>
    <TooltipContent side="top" className="dark">{tooltip ?? label}</TooltipContent>
  </Tooltip>;
}

export function MenuControl({ caption, pressed, onClick, busy, children }: {
  caption: string; pressed?: boolean; onClick?: MouseEventHandler<HTMLButtonElement>;
  busy?: boolean; children: ReactNode;
}) {
  return <Button type="button" variant={pressed ? "secondary" : "ghost"} aria-pressed={pressed} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={onClick} className="h-11 w-full justify-start gap-3">{children}{caption}</Button>;
}
