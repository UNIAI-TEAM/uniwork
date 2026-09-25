"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingCanvas } from "./meeting-canvas";

/**
 * The one screen for "you are not in the room, and here is why": a join that
 * ended for good, a declined request, a room that closed, a lost connection.
 * The signal tile and the title say what happened; the actions say what to do
 * next — never a hang-up button for a call the person never entered.
 */
export function MeetingGateScreen({
  icon,
  tone,
  title,
  description,
  actions,
  meetingTitle,
  alert = false,
  className,
}: {
  icon: LucideIcon;
  tone: IconTileTone;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** The meeting's own name, shown small above the state so people know which call this is. */
  meetingTitle?: string;
  /** Errors are announced assertively; settled states (ended, cancelled) politely. */
  alert?: boolean;
  className?: string;
}) {
  return (
    <MeetingCanvas className={cn("overflow-y-auto", className)}>
      <div
        role={alert ? "alert" : "status"}
        className="m-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-12 text-center"
      >
        <IconTile icon={icon} size="lg" tone={tone} />
        <div className="space-y-1.5">
          {meetingTitle ? <p className="line-clamp-1 text-label text-muted-foreground">{meetingTitle}</p> : null}
          <h1 className="text-balance text-title font-semibold text-foreground">{title}</h1>
          {description ? <p className="text-pretty text-body text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center justify-center gap-2 pt-1">{actions}</div> : null}
      </div>
    </MeetingCanvas>
  );
}
