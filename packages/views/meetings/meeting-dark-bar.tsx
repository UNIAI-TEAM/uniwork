"use client";

import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

/** Dark glass shell for in-room and prejoin control bars on the video rail. */
export const MEETING_DARK_BAR =
  "pointer-events-auto flex items-center gap-2 rounded-2xl border border-meeting-bar-border bg-meeting-bar-bg p-2 shadow-[var(--floating-shadow)] backdrop-blur-md sm:p-2.5";

/** Icon chip on the dark meeting control bar. */
export const MEETING_DARK_BAR_CHIP =
  "size-11 shrink-0 rounded-xl border-meeting-bar-border bg-meeting-bar-chip-bg text-meeting-bar-foreground hover:bg-meeting-bar-chip-hover hover:text-meeting-bar-foreground";

export function MeetingDarkBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(MEETING_DARK_BAR, className)}>{children}</div>;
}
