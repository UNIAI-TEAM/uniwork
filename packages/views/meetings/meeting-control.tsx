"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";

/** Shared presentation only; connecting devices belongs to MeetingControlBar. */
export const MEETING_CHIP = "size-11 shrink-0 rounded-xl";

export function IconControl({ label, tooltip, pressed, tone, onClick, disabled, children }: {
  label: string; tooltip?: string; pressed?: boolean; tone?: "off" | "active";
  onClick?: MouseEventHandler<HTMLButtonElement>; disabled?: boolean; children: ReactNode;
}) {
  return <Tooltip>
    <TooltipTrigger render={<Button type="button" size="icon-lg" variant={tone === "off" ? "destructiveSolid" : tone === "active" ? "brand" : "meetingChip"} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={MEETING_CHIP} />}>{children}</TooltipTrigger>
    <TooltipContent side="top">{tooltip ?? label}</TooltipContent>
  </Tooltip>;
}

export function MenuControl({ caption, pressed, onClick, disabled, children }: {
  caption: string; pressed?: boolean; onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean; children: ReactNode;
}) {
  return <Button type="button" variant={pressed ? "secondary" : "ghost"} aria-pressed={pressed} disabled={disabled} onClick={onClick} className="h-11 w-full justify-start gap-3">{children}{caption}</Button>;
}
